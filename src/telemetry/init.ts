/**
 * Telemetry initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { MonCloudTelemetryProvider } from './moncloud.js';
import { NoOpTelemetryProvider } from './noop.js';
import { TelemetryProvider } from './types.js';

/**
 * Initialize the telemetry provider based on configuration.
 *
 * This function should be called early in application startup, before any
 * HTTP requests or other instrumented operations occur.
 *
 * @returns A configured telemetry provider
 *
 * @example
 * ```typescript
 * async function main() {
 *   // Initialize telemetry first
 *   const telemetry = await initializeTelemetry();
 *
 *   // Add global attributes
 *   telemetry.addAttributes({
 *     'tableau.server': config.server,
 *     'mcp.version': '1.0.0',
 *   });
 *
 *   // Start application...
 * }
 * ```
 */
export async function initializeTelemetry(): Promise<TelemetryProvider> {
  const config = getConfig();

  // If telemetry is disabled, use NoOp provider
  if (!config.telemetry.enabled) {
    const provider = new NoOpTelemetryProvider();
    await provider.initialize();
    return provider;
  }

  let provider: TelemetryProvider;

  try {
    // Select provider based on configuration
    switch (config.telemetry.provider) {
      case 'moncloud':
        provider = new MonCloudTelemetryProvider();
        break;

      case 'custom':
        // Load custom provider from user's filesystem
        provider = await loadCustomProvider(config.telemetry.providerConfig);
        break;

      case 'noop':
      default:
        if (config.telemetry.provider !== 'noop') {
          console.warn(
            `Unknown telemetry provider: ${config.telemetry.provider}. Using NoOp provider.`,
          );
        }
        provider = new NoOpTelemetryProvider();
    }

    // Initialize the provider
    await provider.initialize();
    return provider;
  } catch (error) {
    console.error('Failed to initialize telemetry provider:', error);
    console.warn('Falling back to NoOp telemetry provider');

    // Fallback to NoOp on error - telemetry failures shouldn't break the application
    const fallbackProvider = new NoOpTelemetryProvider();
    await fallbackProvider.initialize();
    return fallbackProvider;
  }
}

/**
 * Load a custom telemetry provider from user's filesystem or npm package.
 *
 * The custom provider module should export a default class that implements TelemetryProvider.
 *
 * @param config - Provider configuration containing the module path
 * @returns A configured custom telemetry provider
 *
 * @example Custom provider from file
 * ```bash
 * TELEMETRY_PROVIDER=custom
 * TELEMETRY_PROVIDER_CONFIG='{"module":"./my-telemetry.js"}'
 * ```
 *
 * @example Custom provider from npm package
 * ```bash
 * TELEMETRY_PROVIDER=custom
 * TELEMETRY_PROVIDER_CONFIG='{"module":"my-company-telemetry"}'
 * ```
 */
async function loadCustomProvider(config?: Record<string, unknown>): Promise<TelemetryProvider> {
  if (!config?.module) {
    throw new Error(
      'Custom telemetry provider requires "module" in providerConfig. ' +
        'Example: TELEMETRY_PROVIDER_CONFIG=\'{"module":"./my-telemetry.js"}\'',
    );
  }

  const modulePath = config.module as string;

  // Determine if it's a file path or npm package name
  let resolvedPath: string;

  if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
    // File path - resolve relative to process working directory (user's project root)
    resolvedPath = resolve(process.cwd(), modulePath);
  } else {
    // npm package name - import as-is
    resolvedPath = modulePath;
  }

  try {
    // Dynamically import the custom provider module
    const module = await import(resolvedPath);

    // Look for default export or named export "TelemetryProvider"
    const ProviderClass = module.default || module.TelemetryProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "TelemetryProvider" ` +
          'that implements the TelemetryProvider interface',
      );
    }

    // Instantiate the provider with the full config
    return new ProviderClass(config);
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom telemetry provider from "${modulePath}". `;

    if ((error as any).code === 'ERR_MODULE_NOT_FOUND') {
      errorMessage +=
        'Module not found. ' +
        'If using a file path, ensure the file exists and the path is correct. ' +
        'If using an npm package, ensure it is installed.';
    } else {
      errorMessage += `Error: ${error}`;
    }

    throw new Error(errorMessage);
  }
}
