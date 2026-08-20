/**
 * Upload URL provider initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { ServerUploadUrlProvider } from './serverUploadUrlProvider.js';
import type { UploadUrlProvider } from './uploadUrlProvider.js';

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Validate that a provider implements the UploadUrlProvider interface.
 *
 * The contract is intentionally checked against the interface itself, not a
 * concrete class prototype: `getUploadUrl` is the only required method.
 */
function validateUploadUrlProvider(provider: unknown): asserts provider is UploadUrlProvider {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  if (typeof provider.getUploadUrl !== 'function') {
    throw new Error('Custom provider missing required method: getUploadUrl');
  }
}

// Module singleton
let globalUploadUrlProvider: UploadUrlProvider | null = null;

/**
 * Get the global upload URL provider instance.
 * If not initialized via initializeUploadUrlProvider(), lazily constructs a default ServerUploadUrlProvider.
 *
 * @returns The upload URL provider
 */
export function getUploadUrlProvider(): UploadUrlProvider {
  if (globalUploadUrlProvider === null) {
    // Lazy initialization with default server provider
    globalUploadUrlProvider = new ServerUploadUrlProvider();
  }
  return globalUploadUrlProvider;
}

/**
 * Initialize the upload URL provider based on configuration.
 *
 * This function should be called early in application startup to ensure
 * the upload URL provider is ready before tools register.
 *
 * @returns A configured upload URL provider
 *
 * @example
 * function main() {
 *   // Initialize upload URL provider first
 *   const uploadUrlProvider = initializeUploadUrlProvider();
 *
 *   // Start application...
 * }
 */
export function initializeUploadUrlProvider(): UploadUrlProvider {
  try {
    const config = getConfig();
    let provider: UploadUrlProvider;

    // Select provider based on configuration
    switch (config.uploadUrl.provider) {
      case 'custom':
        // Load custom provider from user's filesystem
        provider = loadCustomProvider(config.uploadUrl.providerConfig);
        break;

      case 'server':
      default:
        provider = new ServerUploadUrlProvider();
        break;
    }

    globalUploadUrlProvider = provider;
    return provider;
  } catch (error) {
    log({
      message: 'Failed to initialize upload URL provider',
      level: 'error',
      logger: 'uploadUrl',
      data: error,
    });
    log({
      message: 'Falling back to server upload URL provider',
      level: 'info',
      logger: 'uploadUrl',
    });

    // Fallback to server provider on error
    const fallbackProvider = new ServerUploadUrlProvider();
    globalUploadUrlProvider = fallbackProvider;
    return fallbackProvider;
  }
}

/**
 * Load a custom upload URL provider from user's filesystem or npm package.
 *
 * The custom provider module should export a default class that implements UploadUrlProvider.
 *
 * @param config - Provider configuration containing the module path
 * @returns A configured custom upload URL provider
 *
 * @example Custom provider from file
 * UPLOAD_URL_PROVIDER=custom
 * UPLOAD_URL_PROVIDER_CONFIG='{"module":"./my-upload-url-provider.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): UploadUrlProvider {
  if (!config?.module) {
    throw new Error(
      'Custom upload URL provider requires "module" in providerConfig. ' +
        'Example: UPLOAD_URL_PROVIDER_CONFIG=\'{"module":"./my-upload-url-provider.js"}\'',
    );
  }

  const modulePath = config.module;

  if (typeof modulePath !== 'string') {
    throw new Error('Custom upload URL provider requires "module" to be a string');
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

    // Look for default export or named export "UploadUrlProvider"
    const ProviderClass = module.default || module.UploadUrlProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "UploadUrlProvider" ` +
          'that implements the UploadUrlProvider interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements UploadUrlProvider interface
    validateUploadUrlProvider(provider);
    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom upload URL provider from "${modulePath}". `;

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
 * Reset the global upload URL provider instance (for testing purposes only)
 */
export function resetUploadUrlProvider(): void {
  globalUploadUrlProvider = null;
}
