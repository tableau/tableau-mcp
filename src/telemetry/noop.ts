/**
 * NoOp telemetry provider - does nothing.
 * This is the default provider when telemetry is disabled.
 *
 * Zero overhead implementation that can be safely used in production
 * when telemetry is not needed.
 */

import { TelemetryAttributes, TelemetryProvider } from './types.js';

export class NoOpTelemetryProvider implements TelemetryProvider {
  initialize(): void {
    // No-op
  }

  recordMetric(_name: string, _value: number, _attributes: TelemetryAttributes): void {
    // No-op
  }
}
