import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import {
  currentEpisodeId,
  emitEpisodeEvent,
  emitToolErrorEvent,
  episodeSessionIdFromArgs,
} from '../../desktop/episode-events.js';
import { log } from '../../logging/logger.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { LogAndExecuteParams, Tool } from '../tool.js';
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

    try {
      const result = await callback();
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
      });
      return toolResult;
    } catch (error) {
      log({
        message: 'Tool execution failed',
        level: 'error',
        logger: 'tool',
        data: error,
      });
      await emitToolErrorEvent({ config: extra.config, sessionId, tool: this.name, error });
      toolResult = getErrorResult(requestId, error);
      await emitEpisodeEvent(extra.config, {
        type: 'tool_end',
        session_id: sessionId,
        episode_id: episodeId,
        tool: this.name,
        duration_ms: Date.now() - startedAt,
        success: false,
      });
      return toolResult;
    }
  }
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
