import { ExpiringKeyValueMap } from '../utils/expiringKeyValueMap.js';
import type { SessionStore } from './sessionStore.js';

/** Memory session store: each instance has a fixed TTL and its own capacity bound. */
export class InMemorySessionStore<V> extends ExpiringKeyValueMap<V> implements SessionStore<V> {
  private readonly ttlMs: number;

  constructor(options: { ttlMs: number; maxSize?: number }) {
    if (!Number.isFinite(options?.ttlMs)) {
      throw new Error('ttlMs must be a finite number.');
    }
    super({ maxSize: options.maxSize });
    this.ttlMs = options.ttlMs;
  }

  override set(key: string, value: V): Promise<void> {
    return super.set(key, value, { ttlMs: this.ttlMs });
  }
}
