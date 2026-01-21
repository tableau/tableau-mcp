/**
 * APM agent preload script
 *
 * Use with node -r flag to start APM agent before application code:
 *   node -r ./build/telemetry/tracing.js build/index.js
 *
 * Environment variables:
 * - TELEMETRY_PROVIDER=moncloud - Use MonCloud APM (default: noop)
 */

// Load .env before anything else
import dotenv from 'dotenv';
dotenv.config();

import { initializeTelemetry } from './init.js';

try {
  initializeTelemetry();
} catch (error) {
  console.warn('Failed to initialize telemetry:', error);
}
