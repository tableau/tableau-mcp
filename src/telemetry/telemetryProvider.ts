/**
 * Public, dependency-free provider contract for telemetry.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/telemetry/telemetryProvider`)
 * so external deployments can implement a custom telemetry provider against a stable type,
 * without importing the server's internal config schemas or zod. Keep it free of runtime dependencies.
 *
 * `TelemetryAttributes` is hand-written here (rather than `z.infer` of the internal
 * `telemetryAttributesSchema`) so this file has no runtime imports. A compile-time guard in
 * `./types.ts` asserts the two stay in sync.
 */

/**
 * Attributes/dimensions attached to a telemetry metric.
 * Values can be strings, numbers, booleans, or undefined.
 */
export type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Telemetry provider interface for metrics collection.
 */
export interface TelemetryProvider {
  /**
   * Initialize the telemetry provider.
   */
  initialize(): void;

  /**
   * Record a custom metric with the given name and attributes.
   *
   * @param name - The metric name (e.g., 'apm_mcp_tool_calls')
   * @param value - The metric value (default: 1 for counters)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordMetric('apm_mcp_tool_calls', 1, {
   *   tool_name: 'list-pulse-metric-subscriptions',
   * });
   * ```
   */
  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void;

  /**
   * Record a histogram observation (e.g., latency) with the given name and attributes.
   *
   * @param name - The metric name (e.g., 'http_server_request_duration')
   * @param value - The observed value (e.g., duration in milliseconds)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordHistogram('apm_mcp_tool_duration', 142.5, {
   *   tool_name: 'get-datasource-metadata',
   *   success: true,
   * });
   * ```
   */
  recordHistogram(name: string, value: number, attributes: TelemetryAttributes): void;
}
