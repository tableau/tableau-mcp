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
import { log } from '../../logging/logger.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { LogAndExecuteParams, Tool, ToolParams } from '../tool.js';
import { getStructuredContent } from './structuredContent.js';
import { TableauDesktopRequestHandlerExtra, TableauDesktopToolCallback } from './toolContext.js';
import { DesktopToolName } from './toolName.js';

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
> & { minApiVersion?: string };

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
  readonly minApiVersion?: string;

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

    let toolResult: CallToolResult;
    const sessionId = episodeSessionIdFromArgs(extra.config, args);
    const episodeId = currentEpisodeId(sessionId);

    void emitEpisodeEvent(extra.config, {
      type: 'tool_start',
      session_id: sessionId,
      episode_id: episodeId,
      tool: this.name,
    });
    const startedAt = performance.now();

    try {
      const result = await raceDeadline(extra, callback);
      if (result.isOk()) {
        toolResult = getSuccessResult
          ? getSuccessResult(result.value)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(result.value) }],
            };
        void emitEpisodeEvent(extra.config, {
          type: 'tool_end',
          session_id: sessionId,
          episode_id: episodeId,
          tool: this.name,
          duration_ms: performance.now() - startedAt,
          success: true,
          outcome: 'succeeded',
          request_id_hash: hashRequestId(requestId),
          result_size_chars: serializedResultSize(toolResult),
        });
        return toolResult;
      }

      const structuredContent = getStructuredContent(result.error);
      toolResult = {
        isError: true,
        content: [{ type: 'text', text: result.error.getErrorText() }],
        ...(structuredContent ? { structuredContent } : {}),
      };
      void emitToolErrorEvent({
        config: extra.config,
        sessionId,
        tool: this.name,
        error: result.error.getErrorText(),
      });
      void emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
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
        void emitToolErrorEvent({ config: extra.config, sessionId, tool: this.name, error: text });
        toolResult = { isError: true, content: [{ type: 'text', text }] };
      } else {
        void emitToolErrorEvent({ config: extra.config, sessionId, tool: this.name, error });
        toolResult = getErrorResult(requestId, error);
      }
      void emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: performance.now() - startedAt,
        success: false,
        outcome: 'failed',
        request_id_hash: hashRequestId(requestId),
        result_size_chars: serializedResultSize(toolResult),
      });
      return toolResult;
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
