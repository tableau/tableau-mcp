import { ExpiringMap } from '../utils/expiringMap.js';
import type { SessionStore } from './sessionStore.js';

/**
 * In-memory session store backed by a single ExpiringMap.
 *
 * Composes (does not extend) ExpiringMap so it exposes only the SessionStore contract.
 * Used as the default provider: each namespace gets its own isolated instance.
 */
export class InMemorySessionStore<V> implements SessionStore<V> {
  private readonly map: ExpiringMap<string, V>;

  constructor(options?: { maxSize?: number }) {
    // Every set() below passes an explicit ttlMs, so this default is never used. ExpiringMap's
    // constructor rejects defaultExpirationTimeMs <= 0, so a valid non-zero placeholder is needed.
    this.map = new ExpiringMap<string, V>({
      defaultExpirationTimeMs: 1,
      maxSize: options?.maxSize,
    });
  }

  get(key: string): Promise<V | undefined> {
    return Promise.resolve(this.map.get(key));
  }

  set(key: string, value: V, ttlMs: number): Promise<void> {
    this.map.set(key, value, ttlMs);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  consume(key: string): Promise<V | undefined> {
    // No await between the read and the delete, so this is atomic under Node's single-threaded model.
    const value = this.map.get(key);
    this.map.delete(key);
    return Promise.resolve(value);
  }

  rotate(oldKey: string, newKey: string, value: V, ttlMs: number): Promise<void> {
    // No await between the delete and the set, so both keys are never simultaneously valid.
    this.map.delete(oldKey);
    this.map.set(newKey, value, ttlMs);
    return Promise.resolve();
  }
}
