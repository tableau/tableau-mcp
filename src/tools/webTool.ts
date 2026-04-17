import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { ZodiosValidationError } from '../errors/mcpToolError';
import { log } from '../logging/logger';
import { getRequiredApiScopesForTool, TableauApiScope } from '../server/oauth/scopes';
import { getTelemetryProvider } from '../telemetry/init';
import { getProductTelemetry } from '../telemetry/productTelemetry/telemetryForwarder';
import { getExceptionMessage } from '../utils/getExceptionMessage';
import { getHttpStatus } from '../utils/getHttpStatus';
import { ConstrainedResult, LogAndExecuteParams, Tool, ToolParams } from './tool';
import { TableauWebRequestHandlerExtra } from './webToolContext';
import { ToolName } from './webToolName';

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
export type WebToolLogAndExecuteParams<
  T,
  Args extends ZodRawShape | undefined = undefined,
> = LogAndExecuteParams<T, TableauWebRequestHandlerExtra, Args> & {
  // A function that constrains the success result of the tool
  constrainSuccessResult: (result: T) => ConstrainedResult<T> | Promise<ConstrainedResult<T>>;
};

export class WebTool<Args extends ZodRawShape | undefined = undefined> extends Tool<Args> {
  requiredApiScopes: ReadonlyArray<TableauApiScope>;

  constructor({
    server,
    name,
    description,
    paramsSchema,
    annotations,
    callback,
    disabled,
  }: ToolParams<Args>) {
    super({ server, name, description, paramsSchema, annotations, callback, disabled });

    this.requiredApiScopes = getRequiredApiScopesForTool(name as ToolName);
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
