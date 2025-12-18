/**
 * MonCloud telemetry provider for Salesforce's internal monitoring platform.
 *
 * This provider uses the Salesforce APM Agent (@salesforce/apmagent) which provides
 * auto-instrumentation for Node.js applications.
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

  async initialize(): Promise<void> {
    try {
      // Import the Salesforce APM Agent
      // This must be done before any other application code to enable auto-instrumentation
      const { Apm } = require('@salesforce/apmagent');

      // Import OpenTelemetry API for accessing spans
      // MonCloud agent is built on OpenTelemetry, so we use the standard OTEL API
      const otel = require('@opentelemetry/api');
      this.trace = otel.trace;

      // Create and start the APM agent
      const apm = new Apm();
      apm.start();

      // Once started, the agent automatically instruments:
      // - HTTP requests/responses (including axios, fetch, http/https)
      // - Database queries
      // - External API calls
      // - Errors and exceptions
      // - System metrics (CPU, memory, GC)
      // - Distributed tracing
    } catch (error) {
      console.error('Failed to initialize MonCloud telemetry:', error);
      throw new Error(
        'MonCloud APM agent initialization failed. ' +
          'Ensure @salesforce/apmagent is installed and configured correctly. ' +
          `Error: ${error}`
      );
    }
  }

  addAttributes(attributes: TelemetryAttributes): void {
    // Add custom attributes to the current auto-generated span
    // Using standard OpenTelemetry API (same pattern as external OTEL providers)
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
