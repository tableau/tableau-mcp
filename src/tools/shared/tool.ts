import { BaseToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z, ZodRawShape } from 'zod';

import { McpToolError } from '../../errors/sharedMcpToolError.js';
import { log } from '../../logging/logger.js';
import type { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { LocalToolName } from '../local/toolName.js';
import { Tool, ToolParams } from '../tool.js';
import { TableauRequestHandlerExtra } from '../toolContext.js';
import { SharedToolName } from './toolName.js';

export type SharedRequestHandlerExtra = TableauRequestHandlerExtra<Server>;
type Callback<Args extends ZodRawShape> = BaseToolCallback<
  CallToolResult,
  SharedRequestHandlerExtra,
  Args
>;
type SharedToolParams<Args extends ZodRawShape> = ToolParams<
  Server,
  SharedToolName | LocalToolName,
  SharedRequestHandlerExtra,
  Callback<Args>,
  Args
>;

export class SharedTool<Args extends ZodRawShape> extends Tool<
  Server,
  SharedToolName | LocalToolName,
  SharedRequestHandlerExtra,
  Callback<Args>,
  Args
> {
  readonly minApiVersion?: undefined;
  constructor(params: SharedToolParams<Args>) {
    super(params);
  }

  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
  }: {
    extra: SharedRequestHandlerExtra;
    args: z.objectOutputType<Args, z.ZodTypeAny>;
    callback: () => Promise<Result<T, McpToolError>>;
    getSuccessResult?: (result: T) => CallToolResult;
  }): Promise<CallToolResult> {
    this.notifyInvocation({ requestId: extra.requestId, args });
    try {
      if (extra.signal.aborted) {
        throw extra.signal.reason ?? new Error('Tool call aborted');
      }
      const result = await callback();
      if (result.isErr()) {
        return { isError: true, content: [{ type: 'text', text: result.error.getErrorText() }] };
      }
      return (
        getSuccessResult?.(result.value) ?? {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(result.value) }],
        }
      );
    } catch (error) {
      log({ message: 'Tool execution failed', level: 'error', logger: 'tool', data: error });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `requestId: ${extra.requestId}, error: ${getExceptionMessage(error)}`,
          },
        ],
      };
    }
  }
}
