import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { ZodiosValidationError } from '../../errors/mcpToolError.js';
import { log } from '../../logging/logger.js';
import { WebMcpServer } from '../../server.web.js';
import { getRequiredApiScopesForTool, TableauApiScope } from '../../server/oauth/scopes.js';
import {
  getClientDisplayName,
  sanitizeClientIdForTelemetry,
} from '../../telemetry/clientDisplayName.js';
import { getTelemetryProvider } from '../../telemetry/init.js';
import { getProductTelemetry } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../utils/getHttpStatus.js';
import { LogAndExecuteParams, Tool, ToolParams } from '../tool.js';
import { TableauWebRequestHandlerExtra, TableauWebToolCallback } from './toolContext.js';
import { WebToolName } from './toolName.js';

export type ToolRules = Record<string, boolean | undefined>;

/**
 * MCP App metadata for tools that provide interactive UI capabilities.
 *
 * MCP Apps extend standard MCP tools by registering additional resources
 * (HTML/JavaScript) that clients can render as interactive interfaces.
 */
export type AppDetails = {
  name: string;
  resourceUri: string;
  htmlPath: string;
};

/**
 * Result wrapper for MCP App tools
 *
 * Tools that provide an MCP app (interactive UI) should return this structure
 * to ensure they provide both the data AND a URL for the app to display.
 *
 * @typeParam T - The actual data type your tool returns
 */
export type AppToolResult<T> = {
  /** The actual data/content returned by the tool */
  data: T;
  /** A URL that the MCP app can use (e.g., for embedding or navigation) */
  url: string;
};

export type ToolMeta = {
  ui?: {
    visibility?: Array<'model' | 'app'>;
  };
};

export type WebToolParams<Args extends ZodRawShape | undefined = undefined> = ToolParams<
  WebMcpServer,
  WebToolName,
  TableauWebRequestHandlerExtra,
  TableauWebToolCallback<Args>,
  Args
> &
  (
    | {
        app?: AppDetails;
        meta?: never;
      }
    | {
        app?: never;
        meta?: ToolMeta;
      }
  );

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
      error?: Error;
    };

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
export type WebToolLogAndExecuteParams<
  T,
  Args extends undefined | ZodRawShapeCompat | AnySchema,
> = LogAndExecuteParams<T, WebMcpServer, TableauWebRequestHandlerExtra, Args> & {
  // A function that constrains the success result of the tool
  constrainSuccessResult: (result: T) => ConstrainedResult<T> | Promise<ConstrainedResult<T>>;
};

export class WebTool<Args extends ZodRawShape | undefined = undefined> extends Tool<
  WebMcpServer,
  WebToolName,
  TableauWebRequestHandlerExtra,
  TableauWebToolCallback<Args>,
  Args
> {
  requiredApiScopes: ReadonlyArray<TableauApiScope>;
  app?: AppDetails;
  meta?: ToolMeta;

  constructor({
    server,
    name,
    description,
    paramsSchema,
    annotations,
    callback,
    disabled,
    app,
    meta,
  }: WebToolParams<Args>) {
    super({ server, name, description, paramsSchema, annotations, callback, disabled });

    this.requiredApiScopes = getRequiredApiScopesForTool(name as WebToolName);
    this.app = app;
    this.meta = meta;
  }

  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
    constrainSuccessResult,
  }: WebToolLogAndExecuteParams<T, Args>): Promise<CallToolResult> {
    const { config, requestId, sessionId, tableauAuthInfo } = extra;
    const username = tableauAuthInfo?.username;

    // The OAuth client_id (a CIMD URL) is carried on tableauAuthInfo only for the Bearer auth path.
    // Embedded OAuth normalizes tableauAuthInfo to 'X-Tableau-Auth' (see accessTokenValidator), but
    // the MCP-level authInfo still carries the client id, so fall back to it. The raw value is
    // sanitized/bounded before it reaches telemetry (see sanitizeClientIdForTelemetry).
    const oauthClientId =
      (tableauAuthInfo?.type === 'Bearer' ? tableauAuthInfo.clientId : undefined) ??
      extra.authInfo?.clientId;

    this.notifyInvocation({ requestId, args, username });
    log({
      message: `Tool ${this.name} invoked: requestId=${requestId}, args=${JSON.stringify(args)}`,
      level: 'debug',
      logger: 'tool',
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
          if (isError && constrainedResult.error) {
            errorCode = getHttpStatus(constrainedResult.error);
          }
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
      errorCode = getHttpStatus(result.error);

      if (result.error instanceof ZodiosValidationError) {
        toolResult = getErrorResult(requestId, result.error);
        return toolResult;
      }

      toolResult = {
        isError: true,
        content: [{ type: 'text', text: result.error.getErrorText() }],
      };
      return toolResult;
    } catch (error) {
      if (error instanceof Error) {
        errorCode = getHttpStatus(error); // Default to 500 if no HTTP status can be determined
      }
      if (!errorCode) {
        errorCode = '500'; // Default to 500 if no HTTP status can be determined
      }
      log({
        message: 'Tool execution failed',
        level: 'error',
        logger: 'tool',
        data: error,
      });
      toolResult = getErrorResult(requestId, error);
      return toolResult;
    } finally {
      productTelemetryForwarder.send('tool_call', {
        tool_name: this.name,
        request_id: requestId.toString(),
        session_id: sessionId ?? '',
        site_luid: extra.getSiteLuid(),
        user_luid: extra.getUserLuid(),
        podname: config.server,
        is_hyperforce: config.isHyperforce,
        success,
        error_code: errorCode,
        oauth_client_id: sanitizeClientIdForTelemetry(oauthClientId),
        oauth_client_display_name:
          getClientDisplayName(oauthClientId) ?? sanitizeClientIdForTelemetry(oauthClientId),
      });
      // Record custom metric for this tool call
      const telemetry = getTelemetryProvider();
      telemetry.recordMetric('mcp.tool.calls', 1, {
        tool_name: this.name,
        request_id: requestId.toString(),
        error_code: errorCode,
      });
    }
  }
}

function getErrorResult(requestId: RequestId, error: unknown): CallToolResult {
  if (error instanceof ZodiosValidationError) {
    // Schema validation errors on otherwise successful API calls will not return an "error" result to the MCP client.
    // We instead return the full response from the API with a data quality warning message
    // that mentions why the schema validation failed.
    // This should make it so users don't get "stuck" when our schemas are too strict or wrong.
    // The only con is that the full response from the API might be larger than normal
    // since a successful schema validation "trims" the response down to the shape of the schema.
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: error.internalError,
            warning: error.internalErrorDetails,
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
