import { resolve } from 'path';

import { KeyValueStoreProviderValidationError } from '../errors/mcpToolError.js';
import { loadProviderModule } from '../utils/loadProviderModule.js';
import type { KeyValueStore } from './keyValueStore.js';
import type { KeyValueStoreProviderConfig } from './types.js';

export function validateProvider(provider: unknown): asserts provider is KeyValueStore<unknown> {
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    throw new KeyValueStoreProviderValidationError('Provider must be an object');
  }
  for (const method of ['get', 'set', 'delete', 'consume'] as const) {
    if (typeof (provider as Record<string, unknown>)[method] !== 'function') {
      throw new KeyValueStoreProviderValidationError(
        `Custom provider missing required method: ${method}`,
      );
    }
  }
}

export function loadCustomProvider(config: KeyValueStoreProviderConfig): KeyValueStore<unknown> {
  const modulePath = config.module;
  const resolvedPath =
    modulePath.startsWith('.') || modulePath.startsWith('/')
      ? resolve(process.cwd(), modulePath)
      : modulePath;

  try {
    // Module paths come only from trusted operator configuration, like the other BYOI providers.
    const module = loadProviderModule(resolvedPath, require);
    const ProviderClass = module?.default || module?.KeyValueStore;
    if (!ProviderClass) {
      throw new KeyValueStoreProviderValidationError(
        'Module must export a default class or named export "KeyValueStore"',
      );
    }
    const provider: unknown = new ProviderClass(config);
    validateProvider(provider);
    return provider;
  } catch (error) {
    if (error instanceof KeyValueStoreProviderValidationError) throw error;
    // Module code, constructors, and property getters may throw errors containing configuration.
    throw new Error(
      'Failed to load custom key-value store provider. Check its module export and configuration.',
    );
  }
}
