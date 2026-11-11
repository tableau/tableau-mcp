import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { ZodRawShape } from 'zod';

import { desktopCallTimeoutMessage, isDesktopCallTimeout } from '../../desktop/callDeadline.js';
import {
  currentEpisodeId,
  emitEpisodeEvent,
  emitToolErrorEvent,
  episodeSessionIdFromArgs,
} from '../../desktop/episode-events.js';
import { ApiVersionFloor } from '../../desktop/externalApi/apiVersion.js';
import { sessionLastTool } from '../../desktop/route/last-tool.js';
import { resolveSession } from '../../desktop/session/sessionResolution.js';
import { IncompleteOperationError } from '../../errors/mcpToolError.desktop.js';
import { McpToolError } from '../../errors/mcpToolError.js';
import { log } from '../../logging/logger.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { getProductTelemetry } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { LogAndExecuteParams, Tool, ToolParams } from '../tool.js';
import { recoveryBreadcrumb, routeBreadcrumb } from './nextStep.js';
import { getStructuredContent } from './structuredContent.js';
import { TableauDesktopRequestHandlerExtra, TableauDesktopToolCallback } from './toolContext.js';
import { DesktopToolName } from './toolName.js';

// begin-episode keys episodes by the resolved pid, so tool events must look them up the same way.
// Resolution scans the discovery dir, so it runs only when episode events are on.
export function resolveEpisodeKey(
  config: TableauDesktopRequestHandlerExtra['config'],
  args: unknown,
  fallback: string,
): string {
  if (!config.episodeEventsEnabled) return fallback;
  const session =
    typeof args === 'object' && args !== null ? (args as { session?: unknown }).session : undefined;
  const resolved = resolveSession(typeof session === 'string' ? session : undefined);
  return resolved.isOk() ? resolved.value : fallback;
}

/**
 * The key the route/last-tool trace is stored under: the raw `session` argument the agent passes on
 * every call. The breadcrumb only needs a key consistent across a session's calls, not the resolved
 * Desktop pid, so we skip resolveSession and its per-call filesystem scan. Undefined (no session)
 * disables the breadcrumb for that call.
 */
function sessionTraceKey(args: unknown): string | undefined {
  const session =
    typeof args === 'object' && args !== null ? (args as { session?: unknown }).session : undefined;
  return typeof session === 'string' && session.length > 0 ? session : undefined;
}

/**
 * Fold a route-progress breadcrumb into a success value's body, or return it unchanged. Skips any
 * result that is not a plain object, or that already states its own next action (an existing
 * `nextStep`, or a structuredContent/nextAction envelope such as add-field's prefill or an apply-*
 * done receipt). Fail-open: any fault leaves the value untouched.
 */
function decorateWithNextStep<T>(
  toolName: DesktopToolName,
  previousTool: DesktopToolName | undefined,
  value: T,
): T {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const body = value as Record<string, unknown>;
    if ('nextStep' in body || 'nextAction' in body || getStructuredContent(body)) return value;
    const line = routeBreadcrumb(previousTool, toolName);
    if (!line) return value;
    return { ...body, nextStep: line } as T;
  } catch {
    return value;
  }
}

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
export type DesktopToolLogAndExecuteParams<
  T,
  Args extends undefined | ZodRawShapeCompat | AnySchema,
> = LogAndExecuteParams<T, DesktopMcpServer, TableauDesktopRequestHandlerExtra, Args>;

export type DesktopToolParams<Args extends ZodRawShape | undefined = undefined> = ToolParams<
  DesktopMcpServer,
  DesktopToolName,
  TableauDesktopRequestHandlerExtra,
  TableauDesktopToolCallback<Args>,
  Args
> & { minApiVersion?: ApiVersionFloor };

export class DesktopTool<Args extends ZodRawShape | undefined = undefined> extends Tool<
  DesktopMcpServer,
  DesktopToolName,
  TableauDesktopRequestHandlerExtra,
  TableauDesktopToolCallback<Args>,
  Args
> {
  /**
   * Minimum External Client API version whose Desktop build serves the endpoint this tool
   * drives; unset means no floor.
   */
  readonly minApiVersion?: ApiVersionFloor;

  constructor(params: DesktopToolParams<Args>) {
    super(params);
    this.minApiVersion = params.minApiVersion;
  }

  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
  }: DesktopToolLogAndExecuteParams<T, Args>): Promise<CallToolResult> {
    const { requestId } = extra;
    this.notifyInvocation({ requestId, args });

    let toolResult: CallToolResult | undefined;
    const sessionId = episodeSessionIdFromArgs(extra.config, args);
    const episodeKey = resolveEpisodeKey(extra.config, args, sessionId);
    const episodeId = currentEpisodeId(episodeKey);

    void emitEpisodeEvent(extra.config, {
      type: 'tool_start',
      session_id: episodeKey,
      episode_id: episodeId,
      tool: this.name,
    });
    const startedAt = performance.now();

    // Mirrors the web path's `tool_call` product-telemetry event (see src/tools/web/tool.ts) so
    // desktop tool calls land in the same pipeline. Emitted once, in the finally below.
    const productTelemetryForwarder = getProductTelemetry();
    let success = false;
    // errorCode is McpToolError's HTTP statusCode; errorType its stable `type` slug (e.g.
    // 'args-validation'). Both stay empty unless a typed McpToolError is in play. We send only the
    // slug as `error_message` — the human-readable message is omitted to keep PII off the wire.
    let errorCode = '';
    let errorType = '';

    try {
      const result = await raceDeadline(extra, callback);
      if (result.isOk()) {
        // Fold a route-progress breadcrumb into a mid-sequence result before serializing, then record
        // this tool as the session's last-run step. Weak BYOLLM-fallback models drop the next-action
        // call after a draft result; an adjacent next-step line fixes it. See nextStep.ts.
        const traceKey = sessionTraceKey(args);
        const previousTool = sessionLastTool.get(traceKey);
        const successValue = decorateWithNextStep(this.name, previousTool, result.value);
        sessionLastTool.set(traceKey, this.name);
        toolResult = getSuccessResult
          ? getSuccessResult(successValue)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(successValue) }],
            };
        const mappedError = toolResult.isError === true;
        success = !mappedError;
        if (mappedError) {
          void emitToolErrorEvent({
            config: extra.config,
            sessionId: episodeKey,
            tool: this.name,
            error: 'Tool returned an error result.',
          });
        }
        void emitEpisodeEvent(extra.config, {
          type: 'tool_end',
          session_id: episodeKey,
          episode_id: episodeId,
          tool: this.name,
          duration_ms: performance.now() - startedAt,
          success: !mappedError,
          outcome: mappedError ? 'failed' : 'succeeded',
          request_id_hash: hashRequestId(requestId),
          result_size_chars: serializedResultSize(toolResult),
        });
        return toolResult;
      }

      if (result.error instanceof McpToolError) {
        errorCode = String(result.error.statusCode);
        errorType = result.error.type;
      }
      const structuredContent = getStructuredContent(result.error);
      // A retry-safe failure is recoverable, not a dead end, but a weak BYOLLM-fallback model reads
      // the error, narrates the fix, then drops the next tool-call block. Append a recovery
      // breadcrumb after the error JSON (see nextStep.ts) to keep it going — only when no
      // structuredContent envelope is already steering the client, and never on a non-retry-safe
      // failure, where stopping to report is correct.
      const errorText =
        !structuredContent &&
        result.error instanceof IncompleteOperationError &&
        result.error.isRetrySafe()
          ? `${result.error.getErrorText()}\n\n${recoveryBreadcrumb(this.name)}`
          : result.error.getErrorText();
      toolResult = {
        isError: true,
        content: [{ type: 'text', text: errorText }],
        ...(structuredContent ? { structuredContent } : {}),
      };
      void emitToolErrorEvent({
        config: extra.config,
        sessionId: episodeKey,
        tool: this.name,
        error: result.error.getErrorText(),
      });
      void emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: episodeKey,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: performance.now() - startedAt,
        success: false,
        outcome: 'failed',
        request_id_hash: hashRequestId(requestId),
        result_size_chars: serializedResultSize(toolResult),
      });
      return toolResult;
    } catch (error) {
      const timedOut = isDesktopCallTimeout(error);
      if (error instanceof McpToolError) {
        errorCode = String(error.statusCode);
        errorType = error.type;
      }
      log({
        message: timedOut
          ? 'Tool execution exceeded the Desktop call deadline'
          : 'Tool execution failed',
        level: 'error',
        logger: 'tool',
        data: error,
      });

      if (timedOut) {
        // Report the deadline in the agent's own words, not as a generic failure it can paper over.
        const text = desktopCallTimeoutMessage({
          budgetMs: error.budgetMs,
          tool: this.name,
          session: sessionId,
        });
        void emitToolErrorEvent({
          config: extra.config,
          sessionId: episodeKey,
          tool: this.name,
          error: text,
        });
        toolResult = { isError: true, content: [{ type: 'text', text }] };
      } else {
        void emitToolErrorEvent({
          config: extra.config,
          sessionId: episodeKey,
          tool: this.name,
          error,
        });
        toolResult = getErrorResult(requestId, error);
      }
      void emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: episodeKey,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: performance.now() - startedAt,
        success: false,
        outcome: 'failed',
        request_id_hash: hashRequestId(requestId),
        result_size_chars: serializedResultSize(toolResult),
      });
      return toolResult;
    } finally {
      productTelemetryForwarder.send('tool_call', {
        tool_name: this.name,
        request_id: requestId.toString(),
        // utilizes the desktop stable session GUID (not sessionID which is a process id that can be reused)
        session_id: extra.config.desktopSessionLuid ?? '',
        site_luid: extra.config.siteLuid,
        user_luid: extra.config.userLuid,
        chat_id: extra.config.chatId,
        success,
        error_code: errorCode,
        // Only the error `type` slug (e.g. 'args-validation'); the human-readable message is
        // omitted to keep PII off the wire.
        error_message: errorType,
        auth_type: 'desktop',
        // oauth is omitted due to using stdio for desktop
        oauth_client_id: '',
        oauth_client_display_name: '',
      });
    }
  }
}

function serializedResultSize(result: CallToolResult): number {
  return JSON.stringify(result).length;
}

function hashRequestId(requestId: RequestId): string {
  return createHash('sha256').update(String(requestId)).digest('hex').slice(0, 16);
}

/**
 * Runs the tool body against the per-call clock. A tool that forwards `extra.signal` aborts on
 * its own; this race also covers a tool that awaits something the signal cannot interrupt.
 */
async function raceDeadline<T, Args extends undefined | ZodRawShapeCompat | AnySchema>(
  extra: DesktopToolLogAndExecuteParams<T, Args>['extra'],
  callback: DesktopToolLogAndExecuteParams<T, Args>['callback'],
): ReturnType<DesktopToolLogAndExecuteParams<T, Args>['callback']> {
  const { deadline } = extra;
  if (!deadline) {
    return await callback();
  }

  const work = callback();
  // The loser keeps running; swallow its late rejection so a timeout never leaks unhandled.
  void work.catch(() => undefined);

  return await Promise.race([work, deadline.whenExpired()]);
}

function getErrorResult(requestId: RequestId, error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `requestId: ${requestId}, error: ${getExceptionMessage(error)}`,
      },
    ],
  };
}
