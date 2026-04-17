import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { ZodiosValidationError } from '../errors/mcpToolError';
import { log } from '../logging/logger';
import { getTelemetryProvider } from '../telemetry/init';
import { getProductTelemetry } from '../telemetry/productTelemetry/telemetryForwarder';
import { getExceptionMessage } from '../utils/getExceptionMessage';
import { getHttpStatus } from '../utils/getHttpStatus';
import { TableauDesktopRequestHandlerExtra } from './destkopToolContext';
import { LogAndExecuteParams, Tool } from './tool';

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
export type DesktopToolLogAndExecuteParams<
  T,
  Args extends ZodRawShape | undefined = undefined,
> = LogAndExecuteParams<T, TableauDesktopRequestHandlerExtra, Args>;

export class DesktopTool<Args extends ZodRawShape | undefined = undefined> extends Tool<Args> {
  async logAndExecute<T>({
    extra,
    args,
    callback,
    getSuccessResult,
  }: DesktopToolLogAndExecuteParams<T, Args>): Promise<CallToolResult> {
    const { config, requestId, sessionId } = extra;

    this.logInvocation({ requestId, args });

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
        toolResult = getSuccessResult
          ? getSuccessResult(result.value)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(result.value) }],
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
