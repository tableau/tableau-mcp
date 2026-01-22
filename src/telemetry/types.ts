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
 * Schema for telemetry attributes.
 * Values can be strings, numbers, booleans, or undefined.
 */
export const telemetryAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.undefined()]),
);
export type TelemetryAttributes = z.infer<typeof telemetryAttributesSchema>;

/**
 * Valid telemetry provider names
 */
export const telemetryProviderSchema = z.enum(['noop', 'custom']);
export type TelemetryProviderType = z.infer<typeof telemetryProviderSchema>;

/**
 * Schema for noop telemetry config (no telemetry)
 */
export const noopTelemetryConfigSchema = z.object({
  provider: z.literal('noop'),
});

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
 * Schema for custom telemetry config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-otel-provider.js"
 *   }
 * }
 * ```
 */
export const customTelemetryConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined telemetry config schema (discriminated union)
 */
export const telemetryConfigSchema = z.discriminatedUnion('provider', [
  noopTelemetryConfigSchema,
  customTelemetryConfigSchema,
]);

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

/**
 * Type guard for telemetry provider names
 */
export function isTelemetryProvider(provider: unknown): provider is TelemetryProviderType {
  return telemetryProviderSchema.safeParse(provider).success;
}
