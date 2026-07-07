/**
 * Feature gate initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import type { FeatureGateProvider } from './featureGateProvider.js';
import { ServerFeatureGate } from './serverFeatureGate.js';

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Validate that a provider implements the FeatureGateProvider interface.
 *
 * The contract is intentionally checked against the interface itself, not a
 * concrete class prototype: `isFeatureEnabled` is the only required method.
 */
function validateFeatureGateProvider(provider: unknown): asserts provider is FeatureGateProvider {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  if (typeof provider.isFeatureEnabled !== 'function') {
    throw new Error('Custom provider missing required method: isFeatureEnabled');
  }
}

// Module singleton
let globalFeatureGate: FeatureGateProvider | null = null;

/**
 * Get the global feature gate instance.
 * If not initialized via initializeFeatureGate(), lazily constructs a default ServerFeatureGate.
 *
 * @returns The feature gate provider
 */
export function getFeatureGate(): FeatureGateProvider {
  if (globalFeatureGate === null) {
    // Lazy initialization with default server provider
    globalFeatureGate = new ServerFeatureGate();
  }
  return globalFeatureGate;
}

/**
 * Initialize the feature gate provider based on configuration.
 *
 * This function should be called early in application startup to ensure
 * the feature gate provider is ready before tools register.
 *
 * @returns A configured feature gate provider
 *
 * @example
 * function main() {
 *   // Initialize feature gate first
 *   const featureGate = initializeFeatureGate();
 *
 *   // Start application...
 * }
 */
export function initializeFeatureGate(): FeatureGateProvider {
  try {
    const config = getConfig();
    let provider: FeatureGateProvider;

    // Select provider based on configuration
    switch (config.featureGate.provider) {
      case 'custom':
        // Load custom provider from user's filesystem
        provider = loadCustomProvider(config.featureGate.providerConfig);
        break;

      case 'server':
      default:
        provider = new ServerFeatureGate();
        break;
    }

    globalFeatureGate = provider;
    return provider;
  } catch (error) {
    log({
      message: 'Failed to initialize feature gate provider',
      level: 'error',
      logger: 'featureGate',
      data: error,
    });
    log({
      message: 'Falling back to server feature gate provider',
      level: 'info',
      logger: 'featureGate',
    });

    // Fallback to server provider on error
    const fallbackProvider = new ServerFeatureGate();
    globalFeatureGate = fallbackProvider;
    return fallbackProvider;
  }
}

/**
 * Load a custom feature gate provider from user's filesystem or npm package.
 *
 * The custom provider module should export a default class that implements FeatureGateProvider.
 *
 * @param config - Provider configuration containing the module path
 * @returns A configured custom feature gate provider
 *
 * @example Custom provider from file
 * FEATURE_GATE_PROVIDER=custom
 * FEATURE_GATE_PROVIDER_CONFIG='{"module":"./my-feature-gate.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): FeatureGateProvider {
  if (!config?.module) {
    throw new Error(
      'Custom feature gate provider requires "module" in providerConfig. ' +
        'Example: FEATURE_GATE_PROVIDER_CONFIG=\'{"module":"./my-feature-gate.js"}\'',
    );
  }

  const modulePath = config.module;

  if (typeof modulePath !== 'string') {
    throw new Error('Custom feature gate provider requires "module" to be a string');
  }

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

    // Look for default export or named export "FeatureGateProvider"
    const ProviderClass = module.default || module.FeatureGateProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "FeatureGateProvider" ` +
          'that implements the FeatureGateProvider interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements FeatureGateProvider interface
    validateFeatureGateProvider(provider);
    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom feature gate provider from "${modulePath}". `;

    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
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

/**
 * Reset the global feature gate instance (for testing purposes only)
 */
export function resetFeatureGate(): void {
  globalFeatureGate = null;
}
