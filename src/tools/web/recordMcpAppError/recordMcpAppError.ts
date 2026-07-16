import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { WebMcpServer } from '../../../server.web.js';
import { getProductTelemetry } from '../../../telemetry/productTelemetry/telemetryForwarder.js';
import { WebTool } from '../tool.js';

// Starting field set — the final app-supplied schema is expected to grow later.
const paramsSchema = {
  scenario: z
    .string()
    .describe(
      'The MCP app error category, e.g. TOOL_ERROR, PARSE_ERROR, AUTH_ERROR, EMBED_LOAD_ERROR.',
    ),
  message: z.string().optional().describe('Optional detail describing the error cause.'),
};

/**
 * Records a product-telemetry event when an error occurs in the MCP app UI.
 * Called by the app (never the model) via app.callServerTool. Mirrors the
 * server-side 'tool_call' telemetry pattern, enriching the event with request
 * context the browser bundle does not have.
 */
export const getRecordMcpAppErrorTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const recordMcpAppErrorTool = new WebTool({
    server,
    name: 'record-mcp-app-error',
    description:
      'Records a product-telemetry event when an error occurs in the MCP app UI. This tool is only visible to the app, never the model. It takes an error scenario and optional detail, forwards a telemetry event, and returns immediately.',
    paramsSchema,
    annotations: {
      title: 'Record MCP App Error',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'], // Only visible to the app, not the model
      },
    },
    disabled: !getFeatureGate().isFeatureEnabled('mcp-apps'),
    callback: async (args, extra): Promise<CallToolResult> => {
      return recordMcpAppErrorTool.logAndExecute<{ recorded: true }>({
        extra,
        args,
        callback: async () => {
          const { config, requestId, sessionId } = extra;

          const productTelemetryForwarder = getProductTelemetry(
            config.productTelemetryEndpoint,
            config.productTelemetryEnabled,
            config.server,
          );

          productTelemetryForwarder.send('tableau_mcp_event.completed', {
            scenario: args.scenario,
            message: args.message ?? '',
            request_id: requestId.toString(),
            session_id: sessionId ?? '',
            site_luid: extra.getSiteLuid(),
            user_luid: extra.getUserLuid(),
            podname: config.server,
            is_hyperforce: config.isHyperforce,
          });

          return Ok({ recorded: true as const });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return recordMcpAppErrorTool;
};
