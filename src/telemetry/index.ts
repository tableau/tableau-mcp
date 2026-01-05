/**
 * Telemetry module exports
 *
 * This module provides telemetry interfaces and initialization for the MCP server.
 *
 * @example Initialize and apply telemetry
 * ```typescript
 * import { initializeTelemetry, withTelemetryMiddleware } from './telemetry';
 *
 * const telemetry = await initializeTelemetry();
 * withTelemetryMiddleware(server, telemetry);
 *
 * // All tool calls automatically get telemetry
 * ```
 *
 * @example Implement custom provider
 * ```typescript
 * import type { TelemetryProvider, TelemetryAttributes } from '@tableau/mcp-server/telemetry';
 *
 * export default class MyProvider implements TelemetryProvider {
 *   async initialize() { ... }
 *   addAttributes(attrs: TelemetryAttributes) { ... }
 * }
 * ```
 */

export { initializeTelemetry } from './init.js';
export { withTelemetryMiddleware } from './middleware.js';
export type { TelemetryAttributes, TelemetryConfig, TelemetryProvider } from './types.js';
