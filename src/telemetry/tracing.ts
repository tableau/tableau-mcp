/**
 * APM agent preload script
 *
 * Use with node -r flag to start APM agent before application code:
 *   node -r ./build/telemetry/tracing.js build/index.js
 *
 * Environment variables:
 * - TELEMETRY_ENABLED=true  - Enable telemetry
 * - TELEMETRY_PROVIDER=moncloud - Use MonCloud APM
 */

import { initializeTelemetry } from './init.js';

try {
  initializeTelemetry();
} catch (error) {
  console.warn('Failed to initialize telemetry:', error);
}
