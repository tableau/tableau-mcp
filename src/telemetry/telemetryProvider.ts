/**
 * Public, dependency-free provider contract for telemetry.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/telemetry/telemetryProvider`)
 * so external deployments can implement a custom telemetry provider against a stable type,
 * without importing the server's internal config schemas or zod. Keep it free of runtime dependencies.
 *
 * `TelemetryAttributes` is hand-written here to avoid runtime dependencies.
 */

/**
 * Attributes/dimensions attached to a telemetry metric.
 * Values can be strings, numbers, booleans, or undefined.
 */
export type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Handle to an in-flight span, returned by {@link TelemetryProvider.startSpan}.
 */
export interface SpanHandle {
  /**
   * Ends the span. Pass the error if the operation failed.
   */
  end(error?: unknown): void;
}

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

  /**
   * Starts a span and returns a handle to end it later. Optional: providers that
   * don't implement tracing simply don't have this method, and call sites must
   * feature-detect it (`provider.startSpan?.(...)`).
   *
   * @param name - The span name (e.g., 'tableau.rest_api.request')
   * @param attributes - Dimensions/tags for the span
   */
  startSpan?(name: string, attributes?: TelemetryAttributes): SpanHandle;
}
