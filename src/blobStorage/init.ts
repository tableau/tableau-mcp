/**
 * Blob storage initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import type { BlobStorageProvider } from './blobStorageProvider.js';
import { NoopBlobStorageProvider } from './noopBlobStorageProvider.js';

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Validate that a provider implements the BlobStorageProvider interface.
 *
 * The contract is intentionally checked against the interface itself, not a
 * concrete class prototype: `upload`, `getPresignedUploadUrl`, and `download` are
 * the only required methods.
 */
function validateBlobStorageProvider(provider: unknown): asserts provider is BlobStorageProvider {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  const requiredMethods = ['upload', 'getPresignedUploadUrl', 'download'];
  const missingMethods = requiredMethods.filter((method) => typeof provider[method] !== 'function');

  if (missingMethods.length > 0) {
    throw new Error(`Custom provider missing required methods: ${missingMethods.join(', ')}`);
  }
}

// Module singleton
let globalBlobStorageProvider: BlobStorageProvider | null = null;

// Bookkeeping local to this module: tracks whether the active provider is a
// successfully-loaded custom provider, as opposed to noop or a fallback-after-error.
// Not part of the BlobStorageProvider interface.
let blobStorageEnabled = false;

/**
 * Get the global blob storage provider instance.
 * If not initialized via initializeBlobStorageProvider(), lazily constructs a default
 * NoopBlobStorageProvider.
 *
 * @returns The blob storage provider
 */
export function getBlobStorageProvider(): BlobStorageProvider {
  if (globalBlobStorageProvider === null) {
    // Lazy initialization with default noop provider
    globalBlobStorageProvider = new NoopBlobStorageProvider();
    blobStorageEnabled = false;
  }
  return globalBlobStorageProvider;
}

/**
 * Whether blob storage is backed by a successfully-loaded custom provider.
 * False when the provider is noop, or when a custom provider was configured but
 * failed to load (and initializeBlobStorageProvider() fell back to noop).
 *
 * @returns true only if the active provider is a successfully-loaded custom provider
 */
export function isBlobStorageEnabled(): boolean {
  return blobStorageEnabled;
}

/**
 * Initialize the blob storage provider based on configuration.
 *
 * This function should be called early in application startup to ensure
 * the blob storage provider is ready before tools register.
 *
 * @returns A configured blob storage provider
 *
 * @example
 * function main() {
 *   // Initialize blob storage first
 *   const blobStorage = initializeBlobStorageProvider();
 *
 *   // Start application...
 * }
 */
export function initializeBlobStorageProvider(): BlobStorageProvider {
  try {
    const config = getConfig();
    let provider: BlobStorageProvider;

    // Select provider based on configuration
    switch (config.blobStorage.provider) {
      case 'custom':
        // Load custom provider from user's filesystem
        provider = loadCustomProvider(config.blobStorage.providerConfig);
        blobStorageEnabled = true;
        break;

      case 'noop':
      default:
        provider = new NoopBlobStorageProvider();
        blobStorageEnabled = false;
        break;
    }

    globalBlobStorageProvider = provider;
    return provider;
  } catch (error) {
    log({
      message: 'Failed to initialize blob storage provider',
      level: 'error',
      logger: 'blobStorage',
      data: error,
    });
    log({
      message: 'Falling back to noop blob storage provider',
      level: 'info',
      logger: 'blobStorage',
    });

    // Fallback to noop provider on error
    const fallbackProvider = new NoopBlobStorageProvider();
    globalBlobStorageProvider = fallbackProvider;
    blobStorageEnabled = false;
    return fallbackProvider;
  }
}

/**
 * Load a custom blob storage provider from user's filesystem or npm package.
 *
 * The custom provider module should export a default class that implements BlobStorageProvider.
 *
 * @param config - Provider configuration containing the module path
 * @returns A configured custom blob storage provider
 *
 * @example Custom provider from file
 * BLOB_STORAGE_PROVIDER=custom
 * BLOB_STORAGE_PROVIDER_CONFIG='{"module":"./my-blob-storage.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): BlobStorageProvider {
  if (!config?.module) {
    throw new Error(
      'Custom blob storage provider requires "module" in providerConfig. ' +
        'Example: BLOB_STORAGE_PROVIDER_CONFIG=\'{"module":"./my-blob-storage.js"}\'',
    );
  }

  const modulePath = config.module;

  if (typeof modulePath !== 'string') {
    throw new Error('Custom blob storage provider requires "module" to be a string');
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

    // Look for default export or named export "BlobStorageProvider"
    const ProviderClass = module.default || module.BlobStorageProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "BlobStorageProvider" ` +
          'that implements the BlobStorageProvider interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements BlobStorageProvider interface
    validateBlobStorageProvider(provider);
    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom blob storage provider from "${modulePath}". `;

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
 * Reset the global blob storage provider instance (for testing purposes only)
 */
export function resetBlobStorageProvider(): void {
  globalBlobStorageProvider = null;
  blobStorageEnabled = false;
}
