import { z } from 'zod';

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
   * @param name - The metric name (e.g., 'mcp.tool.calls')
   * @param value - The metric value (default: 1 for counters)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordMetric('mcp.tool.calls', 1, {
   *   tool_name: 'list-pulse-metric-subscriptions',
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
 * Configuration for noop provider (no telemetry)
 */
interface NoopTelemetryConfig {
  provider: 'noop';
}

/**
 * Schema for custom telemetry provider config.
 * Requires 'module' field, allows additional provider-specific options.
 */
export const providerConfigSchema = z
  .object({
    module: z.string({ required_error: 'Custom provider requires "module" path' }),
  })
  .passthrough();

/**
 * Configuration for custom provider with required providerConfig
 */
interface CustomTelemetryConfig {
  provider: 'custom';
  /**
   * Configuration for the custom provider.
   *
   * @example
   * ```json
   * {
   *   "module": "./my-otel-provider.js"
   * }
   * ```
   */
  providerConfig: z.infer<typeof providerConfigSchema>;
}

export type TelemetryConfig = NoopTelemetryConfig | CustomTelemetryConfig;

/**
 * Valid telemetry provider names
 */
const telemetryProviders = ['noop', 'custom'] as const;
type TelemetryProviderType = (typeof telemetryProviders)[number];

/**
 * Type guard for telemetry provider names
 */
export function isTelemetryProvider(provider: unknown): provider is TelemetryProviderType {
  return telemetryProviders.some((p) => p === provider);
}
