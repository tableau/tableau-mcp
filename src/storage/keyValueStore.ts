/**
 * Backend-independent storage operations. Expiration and connection lifecycle are
 * configured on the provider, rather than managed by storage callers.
 */
export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;

  /** Atomically return and remove a value, so at most one caller can consume it. */
  consume(key: string): Promise<V | undefined>;
}
