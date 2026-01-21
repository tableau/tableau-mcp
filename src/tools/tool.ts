import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { getConfig } from '../config.js';
import { getServerUrl } from '../index.js';
import { getToolLogMessage, log } from '../logging/log.js';
import { Server } from '../server.js';
import { tableauAuthInfoSchema } from '../server/oauth/schemas.js';
import { getDirname } from '../utils/getDirname.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { Provider, TypeOrProvider } from '../utils/provider.js';
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
  description: TypeOrProvider<string>;

  // The schema of the tool's parameters
  paramsSchema: TypeOrProvider<Args>;

  // The annotations of the tool
  annotations: TypeOrProvider<ToolAnnotations>;

  // A function that validates the tool's arguments provided by the client
  argsValidator?: TypeOrProvider<ArgsValidator<Args>>;

  // The implementation of the tool itself
  callback: TypeOrProvider<ToolCallback<Args>>;
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

  // The Authentication info provided when OAuth is enabled
  authInfo: AuthInfo | undefined;

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
  description: TypeOrProvider<string>;
  paramsSchema: TypeOrProvider<Args>;
  annotations: TypeOrProvider<ToolAnnotations>;
  argsValidator?: TypeOrProvider<ArgsValidator<Args>>;
  callback: TypeOrProvider<ToolCallback<Args>>;

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

  logInvocation({
    requestId,
    args,
    username,
  }: {
    requestId: RequestId;
    args: unknown;
    username?: string;
  }): void {
    log.debug(
      this.server,
      getToolLogMessage({
        requestId,
        toolName: this.name,
        args,
        username,
      }),
    );
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
    authInfo,
    callback,
    getSuccessResult,
    getErrorText,
    constrainSuccessResult,
  }: LogAndExecuteParams<T, E, Args>): Promise<CallToolResult> {
    const username = authInfo?.extra
      ? tableauAuthInfoSchema.safeParse(authInfo.extra).data?.username
      : undefined;

    this.logInvocation({ requestId, args, username });

    if (args) {
      try {
        (await Provider.from(this.argsValidator))?.(args);
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
          return getSizeLimitedResult({
            result: getSuccessResult(constrainedResult.result),
            requestId,
          });
        }

        return getSizeLimitedResult({
          result: {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify(constrainedResult.result) }],
          },
          requestId,
        });
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

function getSizeLimitedResult({
  result,
  requestId,
}: {
  result: CallToolResult;
  requestId: RequestId;
}): CallToolResult {
  const { resultSizeLimitKb, transport } = getConfig();
  if (resultSizeLimitKb === null) {
    return result;
  }

  if (result.content.length > 0 && result.content[0].type === 'text') {
    const text = result.content[0].text;
    const bytes = new TextEncoder().encode(text);
    const fileSizeKb = Math.ceil(bytes.length / 1024);

    if (fileSizeKb > resultSizeLimitKb) {
      const resultsDirectory = join(getDirname(), 'results');
      if (!existsSync(resultsDirectory)) {
        mkdirSync(resultsDirectory, { recursive: true });
      }

      const filename =
        transport === 'http'
          ? randomUUID()
          : `${new Date().toISOString().replace(/[:.]/g, '-')}_request-${requestId}`;

      const fullFilePath = join(resultsDirectory, `${filename}.txt`);
      writeFileSync(fullFilePath, text);

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: [
              `The tool result is ${fileSizeKb} KB, which is larger than the allowed size of ${resultSizeLimitKb} KB.`,
              transport === 'http'
                ? `The full results can be accessed at: ${getServerUrl()}/results/${filename} but once accessed, the file will be deleted from the server.`
                : `The full results have been written to: ${fullFilePath}`,
            ].join(' '),
          },
        ],
      };
    }
  }
  return result;
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
