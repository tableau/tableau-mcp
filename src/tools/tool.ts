import { randomUUID } from 'node:crypto';

import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';

import { getToolLogMessage, log } from '../logging/log.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ToolName } from './toolName.js';

type ArgsValidator<Args extends ZodRawShape | undefined = undefined> = Args extends ZodRawShape
  ? (args: z.objectOutputType<Args, ZodTypeAny>) => void
  : never;

export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  argsValidator?: ArgsValidator<Args>;
  callback: ToolCallback<Args>;
};

type LogAndExecuteParams<T, E, Args extends ZodRawShape | undefined = undefined> = {
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;
  callback: (requestId: string) => Promise<Result<T, E>>;
  getErrorText?: (requestId: string, error: E) => string;
};

export class Tool<Args extends ZodRawShape | undefined = undefined> {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  argsValidator?: ArgsValidator<Args>;
  callback: ToolCallback<Args>;

  constructor({
    name,
    description,
    paramsSchema,
    annotations,
    argsValidator,
    callback,
  }: ToolParams<Args>) {
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.argsValidator = argsValidator;
    this.callback = callback;
  }

  logInvocation(args: unknown): void {
    log.debug(getToolLogMessage(this.name, args));
  }

  // Overload for E = undefined (getErrorText omitted)
  async logAndExecute<T>(
    params: Omit<LogAndExecuteParams<T, undefined, Args>, 'getErrorText'>,
  ): Promise<CallToolResult>;

  // Overload for E != undefined (getErrorText required)
  async logAndExecute<T, E>(
    params: Required<LogAndExecuteParams<T, E, Args>>,
  ): Promise<CallToolResult>;

  // Implementation
  async logAndExecute<T, E>({
    args,
    callback,
    getErrorText,
  }: LogAndExecuteParams<T, E, Args>): Promise<CallToolResult> {
    const requestId = randomUUID();

    this.logInvocation(args);

    if (args) {
      try {
        this.argsValidator?.(args);
      } catch (error) {
        return getErrorResult(requestId, error);
      }
    }

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
              text: getErrorText(requestId, result.error),
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
