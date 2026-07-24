import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { WebMcpServer } from '../../../server.web.js';
import { getProductTelemetry } from '../../../telemetry/productTelemetry/telemetryForwarder.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';

// Starting field set — the final app-supplied schema is expected to grow later.
const paramsSchema = {
  // Bounded free-form string rather than a hard enum: the event-type set is intentionally
  // app-extensible (see above), so we reject malformed values but not unknown-yet-valid ones.
  event_type: z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'event_type must be SCREAMING_SNAKE_CASE (e.g. TOOL_ERROR).')
    .describe(
      'The event type for product telemetry, e.g. TOOL_ERROR, PARSE_ERROR, AUTH_ERROR, EMBED_LOAD_ERROR, MCP_APP_CLICKED.',
    ),
  // Optional free-text detail: truncate rather than reject so an over-long message never fails
  // the telemetry call (mirrors the length cap in src/telemetry/clientDisplayName.ts).
  message: z
    .string()
    .transform((s) => s.slice(0, 1024))
    .optional()
    .describe('Optional detail or context for the event.'),
};

/**
 * Records a product-telemetry event from the MCP app UI (errors, user actions, etc.).
 * Called by the app (never the model) via app.callServerTool. Mirrors the
 * server-side 'tool_call' telemetry pattern, enriching the event with request
 * context the browser bundle does not have.
 */
export const getRecordEventTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const recordEventTool = new WebTool({
    server,
    name: 'record-event',
    description:
      'Records a product-telemetry event from the MCP app UI (errors, user actions, etc.). This tool is only visible to the app, never the model. It takes an event type and optional detail, forwards a telemetry event, and returns immediately.',
    paramsSchema,
    annotations: {
      title: 'Record Event',
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
    disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('mcp-apps'))),
    callback: async (args, extra): Promise<CallToolResult> => {
      return recordEventTool.logAndExecute<{ recorded: true }>({
        extra,
        args,
        callback: async () => {
          const { config } = extra;

          const productTelemetryForwarder = getProductTelemetry(
            config.productTelemetryEndpoint,
            config.productTelemetryEnabled,
            config.server,
          );

          productTelemetryForwarder.send('tableau_mcp_event', {
            event_type: args.event_type,
            message: args.message ?? '',
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

  return recordEventTool;
};
