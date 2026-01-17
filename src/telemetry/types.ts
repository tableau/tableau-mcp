/**
 * Telemetry types and interfaces for the MCP server
 */

/**
 * Telemetry provider interface for metrics collection.
 *
 * @example OpenTelemetry implementation
 * ```typescript
 * export default class OpenTelemetryProvider implements TelemetryProvider {
 *   private meter: any;
 *
 *   initialize(): void {
 *     const { NodeSDK } = require('@opentelemetry/sdk-node');
 *     const sdk = new NodeSDK();
 *     sdk.start();
 *     this.meter = require('@opentelemetry/api').metrics.getMeter('my-app');
 *   }
 *
 *   recordMetric(name: string, value: number, attributes: TelemetryAttributes): void {
 *     this.meter.createCounter(name).add(value, attributes);
 *   }
 * }
 * ```
 */
export interface TelemetryProvider {
  /**
   * Initialize the telemetry provider.
   */
  initialize(): void;

  /**
   * Record a custom metric with the given name and attributes.
   *
   * @param name - The metric name (e.g., 'mcp.tool.calls')
   * @param value - The metric value (default: 1 for counters)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordMetric('mcp.tool.calls', 1, {
   *   'mcp.tool.name': 'list-pulse-metric-subscriptions',
   * });
   * ```
   */
  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void;
}

/**
 * Attributes that can be attached to telemetry data.
 * Values can be strings, numbers, booleans, or undefined.
 */
export interface TelemetryAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Base telemetry config
 */
interface TelemetryConfigBase {
  enabled: boolean;
}

/**
 * Configuration for noop provider (no telemetry)
 */
interface NoopTelemetryConfig extends TelemetryConfigBase {
  provider: 'noop';
}

/**
 * Configuration for MonCloud provider (Salesforce hosted)
 */
interface MonCloudTelemetryConfig extends TelemetryConfigBase {
  provider: 'moncloud';
}

/**
 * Configuration for custom provider with required providerConfig
 */
interface CustomTelemetryConfig extends TelemetryConfigBase {
  provider: 'custom';
  /**
   * Configuration for the custom provider.
   *
   * Must include:
   * - module: Path to the provider implementation (e.g., "./my-telemetry.js")
   *
   * @example
   * ```json
   * {
   *   "module": "./my-otel-provider.js"
   * }
   * ```
   */
  providerConfig: Record<string, unknown>;
}

/**
 * Configuration for telemetry providers.
 * providerConfig is required only when provider is 'custom'.
 */
export type TelemetryConfig = NoopTelemetryConfig | MonCloudTelemetryConfig | CustomTelemetryConfig;
