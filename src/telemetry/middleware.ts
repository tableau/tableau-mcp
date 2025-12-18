/**
 * Telemetry middleware for automatic MCP tool instrumentation.
 *
 * This middleware intercepts all MCP tool calls and automatically adds
 * telemetry attributes without needing to wrap individual tools.
 *
 * @example
 * ```typescript
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * import { withTelemetryMiddleware } from './telemetry';
 *
 * const server = new Server(...);
 * const telemetry = await initializeTelemetry();
 *
 * // Apply telemetry middleware once
 * withTelemetryMiddleware(server, telemetry);
 *
 * // All tool calls automatically get telemetry
 * server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *   // Your tool logic - telemetry is automatic
 * });
 * ```
 */

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TelemetryProvider } from './types.js';

/**
 * Apply telemetry middleware to an MCP server.
 *
 * This wraps the tool call handler to automatically add telemetry attributes
 * for every tool invocation. Call this once during server initialization.
 *
 * Automatically adds:
 * - `mcp.tool`: The tool name from request.params.name
 * - `error`, `error.type`, `error.message`: On tool errors
 *
 * @param server - The MCP server instance
 * @param telemetry - The telemetry provider
 * @param extractAttributes - Optional function to extract additional attributes from tool requests
 *
 * @example Basic usage
 * ```typescript
 * withTelemetryMiddleware(server, telemetry);
 * ```
 *
 * @example With custom attributes
 * ```typescript
 * withTelemetryMiddleware(server, telemetry, (request) => {
 *   const args = request.params.arguments as any;
 *   return {
 *     'tableau.workbook_id': args.workbook_id,
 *     'tableau.datasource_id': args.datasource_id,
 *   };
 * });
 * ```
 */
export function withTelemetryMiddleware(
  server: any,
  telemetry: TelemetryProvider,
  extractAttributes?: (request: any) => Record<string, string | number | boolean | undefined>
): void {
  // Store the original handler
  const originalSetRequestHandler = server.setRequestHandler.bind(server);

  // Override setRequestHandler to intercept tool calls
  server.setRequestHandler = (schema: any, handler: any) => {
    // If this is the CallToolRequest handler, wrap it
    if (schema === CallToolRequestSchema) {
      const wrappedHandler = async (request: any) => {
        const toolName = request.params.name;

        // Build attributes
        const attributes: Record<string, string | number | boolean | undefined> = {
          'mcp.tool': toolName,
        };

        // Add custom attributes if provided
        if (extractAttributes) {
          try {
            const customAttributes = extractAttributes(request);
            Object.assign(attributes, customAttributes);
          } catch (error) {
            console.warn('Failed to extract telemetry attributes:', error);
          }
        }

        // Add attributes to current span
        telemetry.addAttributes(attributes);

        // Execute the actual handler
        try {
          const result = await handler(request);
          return result;
        } catch (error) {
          // Add error attributes
          telemetry.addAttributes({
            'error': true,
            'error.type': error instanceof Error ? error.constructor.name : 'Unknown',
            'error.message': error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      };

      // Call original setRequestHandler with wrapped handler
      return originalSetRequestHandler(schema, wrappedHandler);
    }

    // For non-tool handlers, pass through unchanged
    return originalSetRequestHandler(schema, handler);
  };
}
