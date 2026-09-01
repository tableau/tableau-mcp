/**
 * Session store initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { InMemorySessionStore } from './inMemorySessionStore.js';
import type { SessionStore } from './sessionStore.js';

/**
 * Namespace names for the OAuth session stores. Exact string values only matter for key
 * isolation on a shared custom backend; they are exported so call sites reuse them consistently.
 */
export const SESSION_NAMESPACE = {
  pendingAuthorization: 'pendingAuthorization',
  authorizationCode: 'authorizationCode',
  refreshToken: 'refreshToken',
  refreshTokenIndex: 'refreshTokenIndex',
  clientRegistration: 'clientRegistration',
} as const;

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Validate that a provider implements the SessionStore interface.
 *
 * `rotate` is required here even though it is TypeScript-optional on the interface: the OAuth
 * refresh-token rotation call sites invoke it directly with no runtime existence check, so a
 * custom provider missing it would fail at runtime. Missing rotate is reported distinctly from
 * the other required methods.
 */
function validateSessionStore(provider: unknown): asserts provider is SessionStore<unknown> {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  for (const method of ['get', 'set', 'delete', 'consume'] as const) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`Custom provider missing required method: ${method}`);
    }
  }

  if (typeof provider.rotate !== 'function') {
    throw new Error(
      'Custom provider missing required method: rotate. ' +
        'A delete-old + set-new implementation is sufficient, but it must be present because ' +
        'OAuth refresh-token rotation call sites invoke it directly.',
    );
  }
}

/**
 * Session store singleton state.
 *
 * The `memory` marker means "construct a fresh InMemorySessionStore per namespace on demand";
 * `custom` holds the single shared provider that every namespace prefixes into.
 */
type SessionStoreState =
  | { kind: 'memory' }
  | { kind: 'custom'; store: SessionStore<unknown> };

// Module singleton
let state: SessionStoreState | null = null;

/**
 * Initialize the session store provider based on configuration.
 *
 * This function should be called early in application startup. On any loader error it logs
 * and falls back to the in-memory provider.
 *
 * @example
 * function main() {
 *   initializeSessionStore();
 *   // Start application...
 * }
 */
export function initializeSessionStore(): void {
  try {
    const config = getConfig();

    switch (config.sessionStore.provider) {
      case 'custom':
        state = { kind: 'custom', store: loadCustomProvider(config.sessionStore.providerConfig) };
        break;

      case 'memory':
      default:
        state = { kind: 'memory' };
        break;
    }
  } catch (error) {
    log({
      message: 'Failed to initialize session store provider',
      level: 'error',
      logger: 'sessionStore',
      data: error,
    });
    log({
      message: 'Falling back to in-memory session store provider',
      level: 'info',
      logger: 'sessionStore',
    });

    // Fallback to in-memory provider on error
    state = { kind: 'memory' };
  }
}

/**
 * Load a custom session store provider from the user's filesystem or npm package.
 *
 * The custom provider module should export a default class (or named export "SessionStore")
 * that implements SessionStore.
 *
 * @example Custom provider from file
 * SESSION_STORE_PROVIDER=custom
 * SESSION_STORE_PROVIDER_CONFIG='{"module":"./my-session-store.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): SessionStore<unknown> {
  if (!config?.module) {
    throw new Error(
      'Custom session store provider requires "module" in providerConfig. ' +
        'Example: SESSION_STORE_PROVIDER_CONFIG=\'{"module":"./my-session-store.js"}\'',
    );
  }

  const modulePath = config.module;

  if (typeof modulePath !== 'string') {
    throw new Error('Custom session store provider requires "module" to be a string');
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

    // Look for default export or named export "SessionStore"
    const ProviderClass = module.default || module.SessionStore;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "SessionStore" ` +
          'that implements the SessionStore interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements SessionStore interface
    validateSessionStore(provider);
    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom session store provider from "${modulePath}". `;

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
 * Wrap a shared custom store so a single logical namespace prefixes all of its keys, keeping
 * distinct namespaces from colliding on identical raw keys in the shared backend.
 */
function createPrefixedStore<V>(namespace: string, store: SessionStore<unknown>): SessionStore<V> {
  const prefix = `${namespace}:`;
  const shared = store as SessionStore<V>;

  return {
    get: (key) => shared.get(`${prefix}${key}`),
    set: (key, value, ttlMs) => shared.set(`${prefix}${key}`, value, ttlMs),
    delete: (key) => shared.delete(`${prefix}${key}`),
    consume: (key) => shared.consume(`${prefix}${key}`),
    rotate: (oldKey, newKey, value, ttlMs) =>
      shared.rotate!(`${prefix}${oldKey}`, `${prefix}${newKey}`, value, ttlMs),
  };
}

/**
 * Create a session store scoped to a namespace.
 *
 * Lazily initializes the singleton if `initializeSessionStore()` was not called yet, matching
 * `getFeatureGate()`'s lazy-default behavior.
 *
 * On the `memory` path a FRESH InMemorySessionStore is returned on every call (never memoized),
 * so each caller (e.g. each EmbeddedOAuthProvider instance) gets its own isolated, non-leaking
 * state. On the `custom` path a key-prefixing wrapper over the single shared provider is returned.
 */
export function createNamespacedStore<V>(
  namespace: string,
  options?: { maxSize?: number },
): SessionStore<V> {
  if (state === null) {
    initializeSessionStore();
  }

  if (state!.kind === 'custom') {
    return createPrefixedStore<V>(namespace, state!.store);
  }

  return new InMemorySessionStore<V>(options);
}

/**
 * Reset the global session store state (for testing purposes only)
 */
export function resetSessionStore(): void {
  state = null;
}
