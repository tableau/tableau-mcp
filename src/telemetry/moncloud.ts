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

export class MonCloudTelemetryProvider implements TelemetryProvider {
  private trace: any;

  initialize(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync load for preload script
      const { Apm } = require('@salesforce/apmagent');
      const apm = new Apm();
      apm.start();
    } catch (error) {
      console.error('Failed to initialize MonCloud telemetry:', error);
      throw new Error(
        'MonCloud APM agent initialization failed. ' +
          'Ensure @salesforce/apmagent is installed and configured correctly. ' +
          `Error: ${error}`,
      );
    }
  }

  addAttributes(attributes: TelemetryAttributes): void {
    // Add custom attributes to the current auto-generated span
    try {
      const span = this.trace?.getActiveSpan();
      if (span) {
        span.setAttributes(attributes);
      }
    } catch (error) {
      // Log but don't throw - telemetry failures shouldn't break the application
      console.warn('Failed to add telemetry attributes:', error);
    }
  }
}
