/**
 * MonCloud telemetry provider for Salesforce's internal monitoring platform.
 */

import { TelemetryAttributes, TelemetryProvider } from './types.js';
import { Apm } from '@salesforce/apmagent';
import otelApi, { Counter, Meter } from '@opentelemetry/api';

export class MonCloudTelemetryProvider implements TelemetryProvider {
  private meter: Meter | undefined;
  private counters = new Map<string, Counter>();

  initialize(): void {
    try {
      const apm = new Apm();
      apm.start();

      // Get the OpenTelemetry metrics API
      this.meter = otelApi.metrics.getMeter('tableau-mcp');
    } catch (error) {
      console.error('Failed to initialize MonCloud telemetry:', error);
      throw new Error(
        'MonCloud APM agent initialization failed. ' +
          'Ensure @salesforce/apmagent is installed and configured correctly. ' +
          `Error: ${error}`,
      );
    }
  }

  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void {
    try {
      if (!this.meter) {
        return;
      }

      // Get or create counter for this metric name
      let counter = this.counters.get(name);
      if (!counter) {
        counter = this.meter.createCounter(name, {
          description: `Custom metric: ${name}`,
        });
        this.counters.set(name, counter);
      }

      // Record the metric with attributes
      counter.add(value, attributes);
    } catch (error) {
      // Log but don't throw - telemetry failures shouldn't break the application
      console.warn('Failed to record metric:', error);
    }
  }
}
