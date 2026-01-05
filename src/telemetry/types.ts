/**
 * Telemetry types and interfaces for the MCP server
 */

/**
 * Telemetry provider interface for auto-instrumentation.
 *
 * Providers automatically capture HTTP requests, database calls, errors, etc.
 * This interface is for initializing the provider and adding custom business context.
 *
 * @example OpenTelemetry implementation
 * ```typescript
 * export default class OpenTelemetryProvider implements TelemetryProvider {
 *   private trace: any;
 *
 *   initialize(): void {
 *     const { NodeSDK } = require('@opentelemetry/sdk-node');
 *     const sdk = new NodeSDK();
 *     sdk.start();
 *     this.trace = require('@opentelemetry/api').trace;
 *   }
 *
 *   addAttributes(attributes: TelemetryAttributes): void {
 *     this.trace?.getActiveSpan()?.setAttributes(attributes);
 *   }
 * }
 * ```
 *
 * @example Datadog implementation
 * ```typescript
 * export default class DatadogProvider implements TelemetryProvider {
 *   private tracer: any;
 *
 *   initialize(): void {
 *     this.tracer = require('dd-trace').init();
 *   }
 *
 *   addAttributes(attributes: TelemetryAttributes): void {
 *     const span = this.tracer.scope().active();
 *     if (span) {
 *       Object.entries(attributes).forEach(([k, v]) => span.setTag(k, v));
 *     }
 *   }
 * }
 * ```
 */
export interface TelemetryProvider {
  /**
   * Initialize the telemetry provider and start auto-instrumentation.
   *
   * This should start the APM agent which will automatically instrument:
   * - HTTP requests and responses
   * - Database queries
   * - External API calls
   * - Errors and exceptions
   * - System metrics (CPU, memory, GC)
   */
  initialize(): void;

  /**
   * Add custom attributes to the current auto-generated execution context.
   * These will be attached to all auto-generated spans/traces in the current context.
   *
   * Use this to add business-specific context that auto-instrumentation can't capture,
   * such as:
   * - MCP tool names
   * - Tableau resource IDs (workbook, datasource, etc.)
   * - User identifiers
   * - Custom business dimensions
   *
   * @param attributes - Key-value pairs to attach to the current span
   *
   * @example
   * ```typescript
   * telemetry.addAttributes({
   *   'mcp.tool': 'query_workbook',
   *   'tableau.workbook_id': 'abc123',
   *   'user.id': 'user123'
   * });
   * ```
   */
  addAttributes(attributes: TelemetryAttributes): void;
}

/**
 * Attributes that can be attached to telemetry data.
 * Values can be strings, numbers, booleans, or undefined.
 */
export interface TelemetryAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Configuration for telemetry providers
 */
export interface TelemetryConfig {
  /**
   * Enable or disable telemetry
   */
  enabled: boolean;

  /**
   * Type of telemetry provider to use:
   * - 'noop': No telemetry (default)
   * - 'moncloud': Salesforce MonCloud (for hosted version)
   * - 'custom': Load custom provider from user's filesystem
   */
  provider: 'noop' | 'moncloud' | 'custom';

  /**
   * Service name for telemetry
   */
  serviceName: string;

  /**
   * Service version
   */
  serviceVersion: string;

  /**
   * Environment (e.g., 'production', 'staging', 'development')
   */
  environment: string;

  /**
   * Additional configuration specific to the provider.
   *
   * For custom providers, must include:
   * - module: Path to the provider implementation (e.g., "./my-telemetry.js")
   *
   * @example
   * ```json
   * {
   *   "module": "./my-otel-provider.js"
   * }
   * ```
   */
  providerConfig?: Record<string, unknown>;
}
