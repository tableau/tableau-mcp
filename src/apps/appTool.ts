import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
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
import { ConstrainedResult } from '../tools/tool';
import { TableauRequestHandlerExtra, TableauToolCallback } from '../tools/toolContext';
import { ToolName } from '../tools/toolName';
import { getDirname } from '../utils/getDirname';
import { getExceptionMessage } from '../utils/getExceptionMessage';
import { getHttpStatus } from '../utils/getHttpStatus';
import { getSiteLuidFromAccessToken } from '../utils/getSiteLuidFromAccessToken';
import { TypeOrProvider } from '../utils/provider';

type AppName = 'pulse-renderer';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type EmptyObject = {};

type HostSandboxCapabilities = Partial<{
  /** Permissions granted by the host (camera, microphone, geolocation, clipboard-write). */
  permissions: Partial<{
    camera: EmptyObject;
    microphone: EmptyObject;
    geolocation: EmptyObject;
    clipboardWrite: EmptyObject;
  }>;

  /** CSP domains approved by the host. */
  csp: Partial<{
    /** Approved origins for network requests (fetch/XHR/WebSocket). */
    connectDomains: Array<string>;

    /** Approved origins for static resources (scripts, images, styles, fonts). */
    resourceDomains: Array<string>;

    /** Approved origins for nested iframes (frame-src directive). */
    frameDomains: Array<string>;

    /** Approved base URIs for the document (base-uri directive). */
    baseUriDomains: Array<string>;
  }>;
}>;

export type AppToolParams<Args extends ZodRawShape | undefined = undefined> = {
  // The MCP server instance
  server: Server;

  // The name of the tool
  name: ToolName;

  appName: AppName;

  // The description of the tool
  description: TypeOrProvider<string>;

  // The schema of the tool's parameters
  paramsSchema: TypeOrProvider<Args>;

  // The annotations of the tool
  annotations: TypeOrProvider<ToolAnnotations>;

  // The implementation of the tool itself
  callback: TypeOrProvider<TableauToolCallback<Args>>;

  // Sandbox capabilities approved by the host.
  sandboxCapabilities?: HostSandboxCapabilities;
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

  // A function that constrains the success result of the tool
  constrainSuccessResult: (result: T) => ConstrainedResult<T> | Promise<ConstrainedResult<T>>;
};

/**
 * Represents an MCP tool
 *
 * @template Args - The schema of the tool's parameters or undefined if the tool has no parameters
 */
export class AppTool<Args extends ZodRawShape | undefined = undefined> {
  server: Server;
  name: ToolName;
  appName: AppName;
  description: TypeOrProvider<string>;
  paramsSchema: TypeOrProvider<Args>;
  annotations: TypeOrProvider<ToolAnnotations>;
  callback: TypeOrProvider<TableauToolCallback<Args>>;
  sandboxCapabilities?: HostSandboxCapabilities;

  constructor({
    server,
    name,
    appName,
    description,
    paramsSchema,
    annotations,
    callback,
    sandboxCapabilities,
  }: AppToolParams<Args>) {
    this.server = server;
    this.name = name;
    this.appName = appName;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.callback = callback;
    this.sandboxCapabilities = sandboxCapabilities;
  }

  get resourceUri(): `ui://tableau-mcp/${AppName}.html` {
    return `ui://tableau-mcp/${this.appName}.html`;
  }

  get html(): string {
    return readFileSync(join(getDirname(), 'web', `${this.appName}.html`), 'utf-8');
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
    constrainSuccessResult,
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
        const constrainedResult = await constrainSuccessResult(result.value);

        if (constrainedResult.type !== 'success') {
          // Constrained result is either 'empty' or 'error'
          const isError = constrainedResult.type === 'error';
          success = !isError;
          errorCode =
            isError && constrainedResult.error ? getHttpStatus(constrainedResult.error) : '';
          toolResult = {
            isError,
            content: [{ type: 'text', text: constrainedResult.message }],
          };
          return toolResult;
        }

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
