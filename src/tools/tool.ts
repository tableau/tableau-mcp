import { randomUUID } from 'node:crypto';

import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { ZodRawShape } from 'zod';

import { getToolLogMessage, log } from '../logging/log.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ToolName } from './toolName.js';

export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  callback: ToolCallback<Args>;
};

type LogAndExecuteParams<T, E> = {
  args: unknown;
  callback: (requestId: string) => Promise<Result<T, E>>;
  getErrorText?: (error: E) => string;
};

export class Tool<Args extends ZodRawShape | undefined = undefined> {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  callback: ToolCallback<Args>;

  constructor({ name, description, paramsSchema, annotations, callback }: ToolParams<Args>) {
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.callback = callback;
  }

  logInvocation(args: unknown): void {
    log.debug(getToolLogMessage(this.name, args));
  }

  // Overload for E = undefined (getErrorText omitted)
  async logAndExecute<T>(
    params: Omit<LogAndExecuteParams<T, undefined>, 'getErrorText'>,
  ): Promise<CallToolResult>;

  // Overload for E != undefined (getErrorText required)
  async logAndExecute<T, E>(params: Required<LogAndExecuteParams<T, E>>): Promise<CallToolResult>;

  // Implementation
  async logAndExecute<T, E>({
    args,
    callback,
    getErrorText,
  }: LogAndExecuteParams<T, E>): Promise<CallToolResult> {
    const requestId = randomUUID();

    this.logInvocation(args);

    try {
      const result = await callback(requestId);

      if (result.isOk()) {
        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.value),
            },
          ],
        };
      }

      if (getErrorText) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: getErrorText(result.error),
            },
          ],
        };
      } else {
        return getErrorResult(requestId, result.error);
      }
    } catch (error) {
      return getErrorResult(requestId, error);
    }
  }
}

function getErrorResult(requestId: string, error: unknown): CallToolResult {
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
