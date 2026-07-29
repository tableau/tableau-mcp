import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { desktopCallTimeoutMessage, isDesktopCallTimeout } from '../../desktop/callDeadline.js';
import {
  currentEpisodeId,
  emitEpisodeEvent,
  emitToolErrorEvent,
  episodeSessionIdFromArgs,
} from '../../desktop/episode-events.js';
import { sessionRouteState } from '../../desktop/route/route-state.js';
import { resolveSession } from '../../desktop/sessionResolution.js';
import { log } from '../../logging/logger.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { LogAndExecuteParams, Tool } from '../tool.js';
import { getStructuredContent, prefillNextAction, textToolResult } from './structuredContent.js';
import { TableauDesktopRequestHandlerExtra, TableauDesktopToolCallback } from './toolContext.js';
import { DesktopToolName } from './toolName.js';

const AUTHORING_ATTEMPT_TOOLS: ReadonlySet<DesktopToolName> = new Set([
  'bind-template',
  'author-parameter',
  'author-set',
  'author-calc',
  'author-action',
  'add-field',
  'apply-worksheet',
  'refine-worksheet',
  'execute-tableau-command',
]);

const BIND_FIRST_ORIENTATION_TOOLS: ReadonlySet<DesktopToolName> = new Set(['get-worksheet-xml']);

export const BIND_FIRST_ORIENTATION_REDIRECT =
  "Bind first: call bind-template with the user's verbatim ask (it reads the schema itself), or start with author-parameter/author-set for parameter/set asks. This tool unlocks after the first attempt, for repair and edits.";

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

export class DesktopTool<Args extends ZodRawShape | undefined = undefined> extends Tool<
  DesktopMcpServer,
  DesktopToolName,
  TableauDesktopRequestHandlerExtra,
  TableauDesktopToolCallback<Args>,
  Args
> {
  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
  }: DesktopToolLogAndExecuteParams<T, Args>): Promise<CallToolResult> {
    const { requestId } = extra;
    const bindFirstGateResult = this.applyBindFirstGate(args);
    this.notifyInvocation({ requestId, args });

    let toolResult: CallToolResult;
    const startedAt = Date.now();
    const sessionId = episodeSessionIdFromArgs(extra.config, args);
    const episodeId = currentEpisodeId(sessionId);

    await emitEpisodeEvent(extra.config, {
      type: 'tool_start',
      session_id: sessionId,
      episode_id: episodeId,
      tool: this.name,
    });

    if (bindFirstGateResult) {
      await emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: Date.now() - startedAt,
        success: false,
        outcome: 'refused_by_gate',
      });
      return bindFirstGateResult;
    }

    try {
      const result = await raceDeadline(extra, callback);
      if (result.isOk()) {
        toolResult = getSuccessResult
          ? getSuccessResult(result.value)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(result.value) }],
            };
        await emitEpisodeEvent(extra.config, {
          type: 'tool_end',
          session_id: sessionId,
          episode_id: episodeId,
          tool: this.name,
          duration_ms: Date.now() - startedAt,
          success: true,
          outcome: 'succeeded',
        });
        return toolResult;
      }

      const structuredContent = getStructuredContent(result.error);
      toolResult = {
        isError: true,
        content: [{ type: 'text', text: result.error.getErrorText() }],
        ...(structuredContent ? { structuredContent } : {}),
      };
      await emitToolErrorEvent({
        config: extra.config,
        sessionId,
        tool: this.name,
        error: result.error.getErrorText(),
      });
      await emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: Date.now() - startedAt,
        success: false,
        outcome: 'failed',
      });
      return toolResult;
    } catch (error) {
      const timedOut = isDesktopCallTimeout(error);
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
        await emitToolErrorEvent({ config: extra.config, sessionId, tool: this.name, error: text });
        toolResult = { isError: true, content: [{ type: 'text', text }] };
      } else {
        await emitToolErrorEvent({ config: extra.config, sessionId, tool: this.name, error });
        toolResult = getErrorResult(requestId, error);
      }
      await emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: Date.now() - startedAt,
        success: false,
        outcome: 'failed',
      });
      return toolResult;
    }
  }

  private applyBindFirstGate(args: unknown): CallToolResult | null {
    if (!AUTHORING_ATTEMPT_TOOLS.has(this.name) && !BIND_FIRST_ORIENTATION_TOOLS.has(this.name)) {
      return null;
    }

    const sessionId = bindFirstGateSessionId(args);
    if (AUTHORING_ATTEMPT_TOOLS.has(this.name)) {
      sessionRouteState.recordAuthoringAttempt(sessionId, this.name);
      return null;
    }
    if (!sessionId || sessionRouteState.hasAuthoringAttempt(sessionId)) return null;

    return textToolResult(BIND_FIRST_ORIENTATION_REDIRECT, {
      isError: false,
      nextAction: prefillNextAction("Call bind-template with the user's verbatim ask"),
    });
  }
}

function bindFirstGateSessionId(args: unknown): string | undefined {
  let requestedSession: string | undefined;
  if (typeof args === 'object' && args !== null) {
    const session = (args as { session?: unknown }).session;
    if (typeof session === 'string') requestedSession = session;
  }

  const resolved = resolveSession(requestedSession);
  return resolved.isOk() ? resolved.value : undefined;
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
