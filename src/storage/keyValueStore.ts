/** Required expiration policy for a single write, in milliseconds. */
export interface SetOptions {
  ttlMs: number;
}

/** Backend-independent KV operations with explicit per-write expiration. */
export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, options: SetOptions): Promise<void>;
  delete(key: string): Promise<void>;

  /** Atomically return and remove a value, so at most one caller can consume it. */
  consume(key: string): Promise<V | undefined>;
}
