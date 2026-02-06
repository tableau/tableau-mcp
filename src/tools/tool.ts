import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { getToolLogMessage, log } from '../logging/log.js';
import { Server } from '../server.js';
import { tableauAuthInfoSchema } from '../server/oauth/schemas.js';
import { getTelemetryProvider } from '../telemetry/init.js';
import {
  getProductTelemetry,
  ProductTelemetryBase,
} from '../telemetry/productTelemetry/telemetryForwarder.js';
import { isAxiosError } from '../utils/axios.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { Provider, TypeOrProvider } from '../utils/provider.js';
import { ToolName } from './toolName.js';

/**
 * Extracts HTTP status code from an error if available (e.g., "401", "404", "500")
 * Returns empty string if no HTTP status can be determined
 */
function getHttpStatus(error: Error): string {
  return isAxiosError(error) && error.response?.status ? String(error.response.status) : '';
}

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

  // The session ID from the transport, if available
  sessionId: string | undefined;

  // The Authentication info provided when OAuth is enabled
  authInfo: AuthInfo | undefined;

  // The arguments of the tool call
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;

  // The configuration for product telemetry
  productTelemetryBase: ProductTelemetryBase;

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
    sessionId,
    args,
    authInfo,
    productTelemetryBase,
    callback,
    getSuccessResult,
    getErrorText,
    constrainSuccessResult,
  }: LogAndExecuteParams<T, E, Args>): Promise<CallToolResult> {
    const tableauAuth = authInfo?.extra
      ? tableauAuthInfoSchema.safeParse(authInfo.extra).data
      : undefined;
    const username = tableauAuth?.username;

    this.logInvocation({ requestId, args, username });

    // Record custom metric for this tool call
    const telemetry = getTelemetryProvider();
    telemetry.recordMetric('mcp.tool.calls', 1, {
      tool_name: this.name,
      request_id: requestId.toString(),
    });

    const productTelemetryForwarder = getProductTelemetry(
      productTelemetryBase.endpoint,
      productTelemetryBase.enabled,
    );

    let success = false;
    let errorCode = ''; // HTTP status category: "4xx", "5xx", or empty for successful calls
    let toolResult: CallToolResult;

    try {
      if (args) {
        try {
          (await Provider.from(this.argsValidator))?.(args);
        } catch (error) {
          errorCode = '400'; // Validation errors are client errors
          toolResult = getErrorResult(requestId, error);
          return toolResult;
        }
      }

      const result = await callback();

      if (result.isOk()) {
        const constrainedResult = await constrainSuccessResult(result.value);

        if (constrainedResult.type !== 'success') {
          // Constrained result is either 'empty' or 'error'
          const isError = constrainedResult.type === 'error';
          success = !isError;
          errorCode = ''; // Constrained errors don't have HTTP status
          toolResult = {
            isError,
            content: [{ type: 'text', text: constrainedResult.message }],
          };
          return toolResult;
        }

        success = true;
        toolResult = getSuccessResult
          ? getSuccessResult(constrainedResult.result)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(constrainedResult.result) }],
            };
        return toolResult;
      }

      // Handle error result - extract actual HTTP status if available
      if (result.error instanceof Error) {
        errorCode = getHttpStatus(result.error);
      }

      if (result.error instanceof ZodiosError) {
        toolResult = getErrorResult(requestId, result.error);
        return toolResult;
      }

      toolResult = getErrorText
        ? { isError: true, content: [{ type: 'text', text: getErrorText(result.error) }] }
        : getErrorResult(requestId, result.error);
      return toolResult;
    } catch (error) {
      if (error instanceof Error) {
        errorCode = getHttpStatus(error);
      }
      toolResult = getErrorResult(requestId, error);
      return toolResult;
    } finally {
      // Single telemetry call - always executed
      productTelemetryForwarder.send('tool_call', {
        tool_name: this.name,
        request_id: requestId.toString(),
        session_id: sessionId ?? '',
        site_luid: productTelemetryBase.siteLuid,
        podname: productTelemetryBase.podName,
        success,
        error_code: errorCode,
        parameters: JSON.stringify(args ?? {}),
      });
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
