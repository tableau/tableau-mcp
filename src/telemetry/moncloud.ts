/**
 * MonCloud telemetry provider for Salesforce's internal monitoring platform.
 *
 * Configuration is done via environment variables:
 * - SFDC_SERVICE_NAME: Service name
 * - SFDC_SUBSERVICE_NAME: Subservice name
 * - SFDC_ENV: Environment (e.g., 'prod', 'test')
 * - SFDC_SCOPE1, SFDC_SCOPE2, SFDC_SCOPE3: Scope identifiers
 * - SFDC_METRICS_ENDPOINT: Metrics endpoint URL
 * - SFDC_TRACES_ENDPOINT: Traces endpoint URL
 * - SFDC_EVENTS_ENDPOINT: Events endpoint URL
 *
 * See: https://git.soma.salesforce.com/monitoring/salesforce-apmagent
 */

import { TelemetryAttributes, TelemetryProvider } from './types.js';
import { Apm } from '@salesforce/apmagent';
import otelApi, { Meter } from '@opentelemetry/api';

export class MonCloudTelemetryProvider implements TelemetryProvider {
  private meter: Meter | undefined;
  private counters: Map<string, any> = new Map();

  initialize(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync load for preload script
      const apm = new Apm();
      apm.start();

      // Get the OpenTelemetry metrics API
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync load for preload script
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
