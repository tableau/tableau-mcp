/**
 * MonCloud telemetry provider for Salesforce's internal monitoring platform.
 *
 * This is a custom telemetry provider example that integrates with Salesforce's
 * MonCloud APM platform using OpenTelemetry.
 *
 * Usage:
 *   1. Install dependencies: npm install @salesforce/apmagent @opentelemetry/api
 *   2. Set environment variables:
 *      TELEMETRY_PROVIDER=custom
 *      TELEMETRY_PROVIDER_CONFIG='{"module":"./examples/moncloud-provider.js"}'
 *   3. Set MonCloud-specific env vars:
 *      SFDC_SERVICE_NAME=tableau-mcp
 *      SFDC_SCOPE1=my-org
 *      SFDC_SCOPE2=my-team
 *      SFDC_SCOPE3=my-app
 *      SFDC_ENV=dev
 *
 * @module examples/moncloud-provider
 */

const otelApi = require('@opentelemetry/api');
const { Apm } = require('@salesforce/apmagent');

class MonCloudTelemetryProvider {
  constructor() {
    this.meter = undefined;
    this.counters = new Map();
  }

  initialize() {
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

  recordMetric(name, value, attributes) {
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

// Export as default for custom provider loading
module.exports = MonCloudTelemetryProvider;
module.exports.default = MonCloudTelemetryProvider;
module.exports.TelemetryProvider = MonCloudTelemetryProvider;
