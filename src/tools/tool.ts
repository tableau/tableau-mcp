import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';

import { getToolLogMessage, log } from '../logging/log.js';
import { Server } from '../server/server.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ToolName } from './toolName.js';

type ArgsValidator<Args extends ZodRawShape | undefined = undefined> = Args extends ZodRawShape
  ? (args: z.objectOutputType<Args, ZodTypeAny>) => void
  : never;

export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  server: Server;
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  argsValidator?: ArgsValidator<Args>;
  callback: ToolCallback<Args>;
};

type LogAndExecuteParams<T, E, Args extends ZodRawShape | undefined = undefined> = {
  requestId: RequestId;
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;
  callback: () => Promise<Result<T, E>>;
  getErrorText?: (error: E) => string;
};

export class Tool<Args extends ZodRawShape | undefined = undefined> {
  server: Server;
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  argsValidator?: ArgsValidator<Args>;
  callback: ToolCallback<Args>;

  constructor({
    server,
    name,
    description,
    paramsSchema,
    annotations,
    argsValidator,
    callback,
  }: ToolParams<Args>) {
    this.server = server;
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.argsValidator = argsValidator;
    this.callback = callback;
  }

  logInvocation({ requestId, args }: { requestId: RequestId; args: unknown }): void {
    log.debug(this.server, getToolLogMessage({ requestId, toolName: this.name, args }));
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
    requestId,
    args,
    callback,
    getErrorText,
  }: LogAndExecuteParams<T, E, Args>): Promise<CallToolResult> {
    this.logInvocation({ requestId, args });

    if (args) {
      try {
        this.argsValidator?.(args);
      } catch (error) {
        return getErrorResult(requestId, error);
      }
    }

    try {
      const result = await callback();

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
