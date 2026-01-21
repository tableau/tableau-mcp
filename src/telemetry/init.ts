/**
 * Telemetry initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { MonCloudTelemetryProvider } from './moncloud.js';
import { NoOpTelemetryProvider } from './noop.js';
import { TelemetryProvider } from './types.js';

/**
 * Get all instance methods from a class prototype
 */
function getInstanceMethods(cls: new (...args: unknown[]) => unknown): string[] {
  const methods = new Set<string>();
  let prototype = cls.prototype;

  while (prototype && prototype !== Object.prototype) {
    Object.getOwnPropertyNames(prototype).forEach((name) => {
      if (name !== 'constructor' && typeof prototype[name] === 'function') {
        methods.add(name);
      }
    });
    prototype = Object.getPrototypeOf(prototype);
  }

  return [...methods];
}

/**
 * Validate that a provider implements all required TelemetryProvider methods
 */
function validateTelemetryProvider(provider: unknown): asserts provider is TelemetryProvider {
  if (typeof provider !== 'object' || provider === null) {
    throw new Error('Provider must be an object');
  }

  // Use NoOpTelemetryProvider as the reference implementation
  const requiredMethods = getInstanceMethods(NoOpTelemetryProvider);
  const missingMethods = requiredMethods.filter(
    (method) => typeof (provider as Record<string, unknown>)[method] !== 'function',
  );

  if (missingMethods.length > 0) {
    throw new Error(
      `Custom provider missing required methods: ${missingMethods.join(', ')}`,
    );
  }
}

// Use global to share provider across bundles (tracing.js and index.js)
declare global {
  // eslint-disable-next-line no-var
  var __telemetryProvider: TelemetryProvider | undefined;
}

/**
 * Get the current telemetry provider instance.
 * If not initialized, returns a NoOp provider.
 *
 * @returns The telemetry provider
 */
export function getTelemetryProvider(): TelemetryProvider {
  if (!global.__telemetryProvider) {
    // return a NoOp provider for this request if telemetry hasn't been initialized
    return new NoOpTelemetryProvider();
  }
  return global.__telemetryProvider;
}

/**
 * Initialize the telemetry provider based on configuration.
 *
 * This function should be called early in application startup, before any
 * HTTP requests or other instrumented operations occur.
 *
 * @returns A configured telemetry provider
 *
 * @example
 * function main() {
 *   // Initialize telemetry first
 *   const telemetry = initializeTelemetry();
 *
 *   // Start application...
 * }
 */
export function initializeTelemetry(): TelemetryProvider {
  const config = getConfig();
  let provider: TelemetryProvider;

  try {
    // Select provider based on configuration
    switch (config.telemetry.provider) {
      case 'moncloud':
        provider = new MonCloudTelemetryProvider();
        break;

      case 'custom':
        // Load custom provider from user's filesystem
        provider = loadCustomProvider(config.telemetry.providerConfig);
        break;

      case 'noop':
        provider = new NoOpTelemetryProvider();
        break;
    }

    // Initialize the provider
    provider.initialize();
    global.__telemetryProvider = provider;
    return provider;
  } catch (error) {
    console.error('Failed to initialize telemetry provider:', error);
    console.warn('Falling back to NoOp telemetry provider');

    // Fallback to NoOp on error - telemetry failures shouldn't break the application
    const fallbackProvider = new NoOpTelemetryProvider();
    fallbackProvider.initialize();
    global.__telemetryProvider = fallbackProvider;
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
 * TELEMETRY_PROVIDER=custom
 * TELEMETRY_PROVIDER_CONFIG='{"module":"./my-telemetry.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): TelemetryProvider {
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
    // npm package name - require as-is
    resolvedPath = modulePath;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync load for preload script
    const module = require(resolvedPath);

    // Look for default export or named export "TelemetryProvider"
    const ProviderClass = module.default || module.TelemetryProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "TelemetryProvider" ` +
          'that implements the TelemetryProvider interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements TelemetryProvider interface
    validateTelemetryProvider(provider);

    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom telemetry provider from "${modulePath}". `;

    if ((error as any).code === 'MODULE_NOT_FOUND') {
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
