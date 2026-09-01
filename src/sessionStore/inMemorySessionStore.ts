import { ExpiringMap } from '../utils/expiringMap.js';
import type { SessionStore } from './sessionStore.js';

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAX_SIGNED_INT32 = 2 ** 31 - 1;
const REFRESH_MARGIN_MS = 60_000;
const CHUNK_MS = MAX_SIGNED_INT32 - REFRESH_MARGIN_MS;

/**
 * In-memory session store backed by a single ExpiringMap.
 *
 * Composes (does not extend) ExpiringMap so it exposes only the SessionStore contract.
 * Used as the default provider: each namespace gets its own isolated instance.
 */
export class InMemorySessionStore<V> implements SessionStore<V> {
  private readonly map: ExpiringMap<string, V>;
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();

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
    this.scheduleSet(key, value, ttlMs);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.clearRefreshTimer(key);
    this.map.delete(key);
    return Promise.resolve();
  }

  consume(key: string): Promise<V | undefined> {
    // No await between the read and the delete, so this is atomic under Node's single-threaded model.
    this.clearRefreshTimer(key);
    const value = this.map.get(key);
    this.map.delete(key);
    return Promise.resolve(value);
  }

  rotate(oldKey: string, newKey: string, value: V, ttlMs: number): Promise<void> {
    // No await between the delete and the re-arm, so both keys are never simultaneously valid.
    this.clearRefreshTimer(oldKey);
    this.map.delete(oldKey);
    this.scheduleSet(newKey, value, ttlMs);
    return Promise.resolve();
  }

  /**
   * ExpiringMap schedules expiry via a raw setTimeout, which shares Node/setTimeout's 32-bit
   * delay cap (~24.86 days) and throws above it. TTLs beyond that (e.g. a 30-day refresh token)
   * are stored in capped chunks, re-armed on a plain timer each time a chunk elapses, mirroring
   * setLongTimeout's own recursive chunking -- so the logical TTL can exceed the cap even though
   * every individual ExpiringMap.set() call stays under it.
   */
  private scheduleSet(key: string, value: V, ttlMs: number): void {
    this.clearRefreshTimer(key);

    if (ttlMs <= CHUNK_MS) {
      // ExpiringMap requires a strictly positive expiration. Callers may legitimately pass
      // ttlMs <= 0 to represent "already expired" (e.g. tests simulating an expired token via
      // a zero timeout config) and rely on their own expiresAt field for the actual rejection,
      // not on the store evicting the entry at exactly the right instant.
      this.map.set(key, value, Math.max(ttlMs, 1));
      return;
    }

    this.map.set(key, value, CHUNK_MS + REFRESH_MARGIN_MS);
    const remaining = ttlMs - CHUNK_MS;
    const timer = setTimeout(() => {
      this.refreshTimers.delete(key);
      if (this.map.has(key)) {
        this.scheduleSet(key, value, remaining);
      }
    }, CHUNK_MS);
    this.refreshTimers.set(key, timer);
  }

  private clearRefreshTimer(key: string): void {
    const timer = this.refreshTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(key);
    }
  }
}
