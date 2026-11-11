import type { KeyValueStore } from '../storage/keyValueStore.js';

/**
 * Compatibility contract for existing session providers, including their optional hooks.
 *
 * Keep this export at @tableau/mcp-server/sessionStore/sessionStore so existing provider
 * implementations and imports continue to work. New consumers can use
 * @tableau/mcp-server/storage/keyValueStore directly.
 */
export type SessionStore<V> = KeyValueStore<V> & {
  configureNamespace?(namespace: string, options: { ttlMs: number; maxSize?: number }): void;
  init?(): Promise<void>;
  close?(): Promise<void>;
};
