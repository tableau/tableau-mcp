/**
 * Blob storage initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import type { BlobStorageProvider } from './blobStorageProvider.js';

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

// Module singleton; null means blob storage is not configured (or not yet initialized).
let globalBlobStorageProvider: BlobStorageProvider | null = null;

/**
 * Get the configured blob storage provider.
 *
 * Callers must check {@link isBlobStorageEnabled} first and use their no-storage fallback when it
 * is false; calling this while storage is unset is a bug.
 *
 * @returns The blob storage provider
 */
export function getBlobStorageProvider(): BlobStorageProvider {
  if (globalBlobStorageProvider === null) {
    throw new Error(
      'Internal error: getBlobStorageProvider() called while blob storage is not configured. Check isBlobStorageEnabled() first.',
    );
  }
  return globalBlobStorageProvider;
}

/**
 * Whether a custom blob storage provider has been loaded by initializeBlobStorageProvider().
 */
export function isBlobStorageEnabled(): boolean {
  return globalBlobStorageProvider !== null;
}

/**
 * Initialize the blob storage provider based on configuration. Call once at startup.
 *
 * Throws if BLOB_STORAGE_PROVIDER is "custom" but the provider cannot be loaded or fails
 * validation, so a misconfigured provider fails startup instead of silently running with no
 * storage (a real, behavior-changing mode).
 *
 * @returns The configured provider, or undefined when blob storage is unset
 */
export function initializeBlobStorageProvider(): BlobStorageProvider | undefined {
  const config = getConfig();
  globalBlobStorageProvider = null;

  if (!config.blobStorage) {
    return undefined;
  }

  const provider = loadCustomProvider(config.blobStorage.providerConfig);
  globalBlobStorageProvider = provider;
  return provider;
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
      errorMessage += getExceptionMessage(error);
    }

    throw new Error(errorMessage);
  }
}

/**
 * Reset the global blob storage provider instance (for testing purposes only)
 */
export function resetBlobStorageProvider(): void {
  globalBlobStorageProvider = null;
}
