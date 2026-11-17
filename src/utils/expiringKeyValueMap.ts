import { ExpiringMap } from './expiringMap.js';

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAX_SIGNED_INT32 = 2 ** 31 - 1;
const REFRESH_MARGIN_MS = 60_000;
const CHUNK_MS = MAX_SIGNED_INT32 - REFRESH_MARGIN_MS;

/** In-memory records with per-write expiration and optional capacity bounds. */
export class ExpiringKeyValueMap<V> {
  private readonly map: ExpiringMap<string, V>;
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: { maxSize?: number } = {}) {
    this.map = new ExpiringMap<string, V>({
      // Every write supplies its own TTL; this default is never used by set().
      defaultExpirationTimeMs: 1,
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

  async set(key: string, value: V, options: { ttlMs: number }): Promise<void> {
    if (!Number.isFinite(options?.ttlMs)) {
      throw new Error('ttlMs must be a finite number.');
    }
    this.clearRefreshTimer(key);
    const ttlMs = Math.max(options.ttlMs, 1);
    if (ttlMs <= MAX_SIGNED_INT32) {
      this.map.set(key, value, ttlMs);
    } else {
      this.scheduleSet(key, value, ttlMs);
    }
  }

  async close(): Promise<void> {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.map.clear();
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
