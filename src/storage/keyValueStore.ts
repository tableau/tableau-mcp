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

  /**
   * Atomically delete only when the stored value matches expectedValue, using the same
   * encoding as set. A missing key or mismatch returns false without changing the value;
   * backend failures reject. A separate get followed by delete is not sufficient.
   * Optional for existing providers; callers requiring this operation must reject its absence.
   */
  compareAndDelete?(key: string, expectedValue: V): Promise<boolean>;
}
