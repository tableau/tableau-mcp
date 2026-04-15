import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';

import { AppName } from '../apps/appName.js';
import { HostSandboxCapabilities } from '../apps/types.js';
import { McpToolError, ZodiosValidationError } from '../errors/mcpToolError.js';
import { log } from '../logging/logger.js';
import { getNotificationMessageForTool, notifier } from '../logging/notification.js';
import { Server } from '../server.js';
import { getRequiredApiScopesForTool, TableauApiScope } from '../server/oauth/scopes.js';
import { getTelemetryProvider } from '../telemetry/init.js';
import { getProductTelemetry } from '../telemetry/productTelemetry/telemetryForwarder.js';
import { getDirname } from '../utils/getDirname.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { getHttpStatus } from '../utils/getHttpStatus.js';
import { TypeOrProvider } from '../utils/provider.js';
import { TableauRequestHandlerExtra, TableauToolCallback } from './toolContext.js';
import { ToolName } from './toolName.js';

export type ToolRules = Record<string, boolean | undefined>;

type AppDetails = {
  name: AppName;
  sandboxCapabilities?: HostSandboxCapabilities;
};

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

  // Details of the app that the tool can optionally return
  app?: AppDetails;

  // The implementation of the tool itself
  callback: TypeOrProvider<TableauToolCallback<Args>>;

  // When true, the tool is not registered with the MCP server (model never sees it)
  disabled?: TypeOrProvider<boolean>;
};

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
type LogAndExecuteParams<T, Args extends ZodRawShape | undefined = undefined> = {
  // The extra data provided to request handlers
  extra: TableauRequestHandlerExtra;

  // The arguments of the tool call
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;

  // A function that contains the business logic of the tool to be logged and executed
  callback: () => Promise<Result<T, McpToolError>>;

  // A function that can transform a successful result of the callback into a CallToolResult
  getSuccessResult?: (result: T) => CallToolResult;

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
  callback: TypeOrProvider<TableauToolCallback<Args>>;
  app?: AppDetails & {
    resourceUri: `ui://tableau-mcp/${AppName}.html`;
    html: string;
  };
  disabled: TypeOrProvider<boolean>;

  requiredApiScopes: ReadonlyArray<TableauApiScope>;

  constructor({
    server,
    name,
    description,
    paramsSchema,
    annotations,
    app,
    callback,
    disabled,
  }: ToolParams<Args>) {
    this.server = server;
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.callback = callback;

    if (app) {
      const htmlPaths = [
        join(getDirname(), 'web', `${app.name}.html`),

        // When creating the server as part of the E2E/OAuth tests, getDirname() will return "src/utils"
        join(process.cwd(), 'build', 'web', `${app.name}.html`),
      ];

      const htmlPath = htmlPaths.find((path) => existsSync(path));
      if (!htmlPath) {
        throw new Error(`HTML file not found. Checked: ${htmlPaths.join(', ')}`);
      }

      this.app = {
        ...app,
        resourceUri: `ui://tableau-mcp/${app.name}.html`,
        html: process.env.TABLEAU_MCP_TEST
          ? `<html><body><p>${app.name}</p></body></html>`
          : readFileSync(htmlPath, 'utf-8'),
      };
    }
    this.disabled = disabled ?? false;

    this.requiredApiScopes = getRequiredApiScopesForTool(name);
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
    notifier.debug(
      this.server,
      getNotificationMessageForTool({
        requestId,
        toolName: this.name,
        args,
        username,
      }),
    );
  }

  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
    constrainSuccessResult,
  }: LogAndExecuteParams<T, Args>): Promise<CallToolResult> {
    const { config, requestId, sessionId, tableauAuthInfo } = extra;
    const username = tableauAuthInfo?.username;

    this.logInvocation({ requestId, args, username });

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
        message: error,
        level: 'error',
        logger: 'tool',
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
