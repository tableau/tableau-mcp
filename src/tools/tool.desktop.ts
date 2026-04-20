import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { ZodiosValidationError } from '../errors/mcpToolError';
import { log } from '../logging/logger';
import { DesktopMcpServer } from '../server.desktop';
import { getTelemetryProvider } from '../telemetry/init';
import { getProductTelemetry } from '../telemetry/productTelemetry/telemetryForwarder';
import { getExceptionMessage } from '../utils/getExceptionMessage';
import { getHttpStatus } from '../utils/getHttpStatus';
import { LogAndExecuteParams, Tool } from './tool';
import {
  TableauDesktopRequestHandlerExtra,
  TableauDesktopToolCallback,
} from './toolContext.desktop';
import { DesktopToolName } from './toolName.desktop';

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam Args - The schema of the tool's parameters
 */
export type DesktopToolLogAndExecuteParams<
  T,
  Args extends undefined | ZodRawShapeCompat | AnySchema,
> = LogAndExecuteParams<T, DesktopMcpServer, TableauDesktopRequestHandlerExtra, Args>;

export class DesktopTool<Args extends ZodRawShape | undefined = undefined> extends Tool<
  DesktopMcpServer,
  DesktopToolName,
  TableauDesktopRequestHandlerExtra,
  TableauDesktopToolCallback<Args>,
  Args
> {
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
