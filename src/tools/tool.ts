import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { getToolLogMessage, log } from '../logging/log.js';
import { Server } from '../server.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ToolName } from './toolName.js';

type ArgsValidator<Args extends ZodRawShape | undefined = undefined> = Args extends ZodRawShape
  ? (args: z.objectOutputType<Args, ZodTypeAny>) => void
  : never;

export type ConstrainedResult<T> =
  | {
      type: 'success';
      result: T;
    }
  | {
      type: 'empty';
      message: string;
    }
  | {
      type: 'error';
      message: string;
    };

/**
 * The parameters for creating a tool instance
 *
 * @typeParam Args - The schema of the tool's parameters
 */
export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  // The MCP server instance
  server: Server;

  // The name of the tool
  name: ToolName;

  // The description of the tool
  description: string;

  // The schema of the tool's parameters
  paramsSchema: Args;

  // The annotations of the tool
  annotations: ToolAnnotations;

  // A function that validates the tool's arguments provided by the client
  argsValidator?: ArgsValidator<Args>;

  // The implementation of the tool itself
  callback: ToolCallback<Args>;
};

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam E - The type of the error the tool's implementation can return
 * @typeParam Args - The schema of the tool's parameters
 */
type LogAndExecuteParams<T, E, Args extends ZodRawShape | undefined = undefined> = {
  // The request ID of the tool call
  requestId: RequestId;

  // The arguments of the tool call
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;

  // A function that contains the business logic of the tool to be logged and executed
  callback: () => Promise<Result<T, E | ZodiosError>>;

  // A function that can transform a successful result of the callback into a CallToolResult
  getSuccessResult?: (result: T) => CallToolResult;

  // A function that can transform an error result of the callback into a string.
  // Required if the callback can return an error result.
  getErrorText?: (error: E) => string;

  // A function that constrains the success result of the tool
  constrainSuccessResult: (result: T) => ConstrainedResult<T> | Promise<ConstrainedResult<T>>;
};

/**
 * Represents an MCP tool
 *
 * @template Args - The schema of the tool's parameters or undefined if the tool has no parameters
 */
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

  // Overload for E != undefined (getSuccessResult omitted)
  async logAndExecute<T, E>(
    params: Required<Omit<LogAndExecuteParams<T, E, Args>, 'getSuccessResult'>>,
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
    getSuccessResult,
    getErrorText,
    constrainSuccessResult,
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
        const constrainedResult = await constrainSuccessResult(result.value);

        if (constrainedResult.type !== 'success') {
          return {
            isError: constrainedResult.type === 'error',
            content: [{ type: 'text', text: constrainedResult.message }],
          };
        }

        if (getSuccessResult) {
          return getSuccessResult(constrainedResult.result);
        }

        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify(constrainedResult.result),
            },
          ],
        };
      }

      if (result.error instanceof ZodiosError) {
        return getErrorResult(requestId, result.error);
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
  if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
    // Schema validation errors on otherwise successful API calls will not return an "error" result to the MCP client.
    // We instead return the full response from the API with a data quality warning message
    // that mentions why the schema validation failed.
    // This should make it so users don't get "stuck" when our schemas are too strict or wrong.
    // The only con is that the full response from the API might be larger than normal
    // since a successful schema validation "trims" the response down to the shape of the schema.
    const validationError = fromError(error.cause);
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: error.data,
            warning: validationError.toString(),
          }),
        },
      ],
    };
  }

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
