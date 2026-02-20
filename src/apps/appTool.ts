import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Result } from 'ts-results-es';
import z, { ZodRawShape, ZodTypeAny } from 'zod';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { getToolLogMessage, log } from '../logging/log';
import { Server } from '../server';
import { getTelemetryProvider } from '../telemetry/init';
import { getProductTelemetry } from '../telemetry/productTelemetry/telemetryForwarder';
import { TableauRequestHandlerExtra, TableauToolCallback } from '../tools/toolContext';
import { getDirname } from '../utils/getDirname';
import { getExceptionMessage } from '../utils/getExceptionMessage';
import { getHttpStatus } from '../utils/getHttpStatus';
import { getSiteLuidFromAccessToken } from '../utils/getSiteLuidFromAccessToken';
import { TypeOrProvider } from '../utils/provider';

export type AppToolName = 'pulse-renderer';

export type AppToolParams<Args extends ZodRawShape | undefined = undefined> = {
  // The MCP server instance
  server: Server;

  // The name of the tool
  name: AppToolName;

  // The title of the tool
  title: TypeOrProvider<string>;

  // The description of the tool
  description: TypeOrProvider<string>;

  // The schema of the tool's parameters
  paramsSchema: TypeOrProvider<Args>;

  // The implementation of the tool itself
  callback: TypeOrProvider<TableauToolCallback<Args>>;
};

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam E - The type of the error the tool's implementation can return
 * @typeParam Args - The schema of the tool's parameters
 */
type LogAndExecuteParams<T, E, Args extends ZodRawShape | undefined = undefined> = {
  // The extra data provided to request handlers
  extra: TableauRequestHandlerExtra;

  // The arguments of the tool call
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;

  // A function that contains the business logic of the tool to be logged and executed
  callback: () => Promise<Result<T, E | ZodiosError>>;

  // A function that can transform an error result of the callback into a string.
  // Required if the callback can return an error result.
  getErrorText?: (error: E) => string;
};

/**
 * Represents an MCP tool
 *
 * @template Args - The schema of the tool's parameters or undefined if the tool has no parameters
 */
export class AppTool<Args extends ZodRawShape | undefined = undefined> {
  server: Server;
  name: AppToolName;
  title: TypeOrProvider<string>;
  description: TypeOrProvider<string>;
  paramsSchema: TypeOrProvider<Args>;
  callback: TypeOrProvider<TableauToolCallback<Args>>;

  constructor({ server, name, title, description, paramsSchema, callback }: AppToolParams<Args>) {
    this.server = server;
    this.name = name;
    this.title = title;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.callback = callback;
  }

  get resourceUri(): `ui://tableau-mcp/${AppToolName}.html` {
    return `ui://tableau-mcp/${this.name}.html`;
  }

  get html(): string {
    return readFileSync(join(getDirname(), 'web', `${this.name}.html`), 'utf-8');
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
    extra,
    args,
    callback,
    getErrorText,
  }: LogAndExecuteParams<T, E, Args>): Promise<CallToolResult> {
    const { config, requestId, sessionId, tableauAuthInfo } = extra;
    const username = tableauAuthInfo?.username;

    this.logInvocation({ requestId, args, username });

    // Record custom metric for this tool call
    const telemetry = getTelemetryProvider();
    telemetry.recordMetric('mcp.app.calls', 1, {
      app_name: this.name,
      request_id: requestId.toString(),
    });

    const productTelemetryForwarder = getProductTelemetry(
      config.productTelemetryEndpoint,
      config.productTelemetryEnabled,
      config.server,
    );

    let success = false;
    let errorCode = ''; // HTTP status category: "4xx", "5xx", or empty for successful calls
    let toolResult: CallToolResult;

    try {
      const result = await callback();

      if (result.isOk()) {
        success = true;
        toolResult = {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(result.value) }],
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
      productTelemetryForwarder.send('app_call', {
        app_name: this.name,
        request_id: requestId.toString(),
        session_id: sessionId ?? '',
        site_luid: getSiteLuidFromAccessToken(tableauAuthInfo?.accessToken),
        podname: config.server,
        is_hyperforce: config.isHyperforce,
        success,
        error_code: errorCode,
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
