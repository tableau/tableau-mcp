import { ExpiringMap } from '../utils/expiringMap.js';
import type { KeyValueStore } from './keyValueStore.js';

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAX_SIGNED_INT32 = 2 ** 31 - 1;
const REFRESH_MARGIN_MS = 60_000;
const CHUNK_MS = MAX_SIGNED_INT32 - REFRESH_MARGIN_MS;

/**
 * In-memory store backed by an ExpiringMap with a required TTL.
 *
 * Exposes only the KeyValueStore contract.
 * Used as the default provider: each namespace gets its own isolated instance.
 */
export class InMemoryKeyValueStore<V> implements KeyValueStore<V> {
  private readonly map: ExpiringMap<string, V>;
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs: number; maxSize?: number }) {
    if (!Number.isFinite(options?.ttlMs)) {
      throw new Error('ttlMs must be a finite number.');
    }
    this.ttlMs = options.ttlMs;
    // Ordinary TTLs use the map's default. Longer TTLs override it in capped chunks.
    // Preserve the existing one-millisecond minimum for non-positive TTLs.
    this.map = new ExpiringMap<string, V>({
      defaultExpirationTimeMs: Math.min(Math.max(this.ttlMs, 1), MAX_SIGNED_INT32),
      maxSize: options.maxSize,
      // Every ExpiringMap removal (natural expiry, maxSize eviction, explicit delete) routes through
      // delete(), so this hook guarantees the parallel refreshTimers entry is cleared too -- including
      // maxSize evictions that ExpiringMap initiates internally and this store could not otherwise see.
      onDelete: (key) => this.clearRefreshTimer(key),
    });
  }

  get(key: string): Promise<V | undefined> {
    return Promise.resolve(this.map.get(key));
  }

  set(key: string, value: V): Promise<void> {
    if (this.ttlMs <= MAX_SIGNED_INT32) {
      this.map.set(key, value);
    } else {
      this.scheduleSet(key, value, this.ttlMs);
    }
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

  /**
   * ExpiringMap schedules expiry via a raw setTimeout, which shares Node/setTimeout's 32-bit
   * delay cap (~24.86 days) and throws above it. TTLs beyond that (e.g. a 30-day refresh token)
   * are stored in capped chunks, re-armed on a plain timer each time a chunk elapses, mirroring
   * setLongTimeout's own recursive chunking -- so the logical TTL can exceed the cap even though
   * every individual ExpiringMap.set() call stays under it.
   */
  private scheduleSet(key: string, value: V, ttlMs: number): void {
    const map = this.map;
    this.clearRefreshTimer(key);
    if (ttlMs <= CHUNK_MS) {
      map.set(key, value, ttlMs);
      return;
    }

    map.set(key, value, CHUNK_MS + REFRESH_MARGIN_MS);
    const remaining = ttlMs - CHUNK_MS;
    const timer = setTimeout(() => {
      this.refreshTimers.delete(key);
      if (this.map.has(key)) {
        this.scheduleSet(key, value, remaining);
      }
    }, CHUNK_MS);
    // This is a long-lived background re-arm timer; it must not keep the Node event loop alive
    // (and thus block process shutdown) just because a chunk boundary is still pending.
    timer.unref();
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
