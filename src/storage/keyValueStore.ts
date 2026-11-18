/** Required expiration policy for a single write, in milliseconds. */
export interface SetOptions {
  /**
   * Required finite lifetime for this write, in milliseconds. set() must reject non-finite values.
   * The built-in memory provider clamps non-positive values to one millisecond.
   */
  ttlMs: number;
}

/**
 * Backend-independent KV operations with explicit per-write expiration.
 *
 * All operations return promises and must reject on backend errors. A failed read must not be
 * reported as a missing key. Providers own serialization and must reject values that cannot be
 * encoded faithfully or exceed backend limits.
 */
export interface KeyValueStore<V> {
  /** Return the value, or undefined if the key is absent or expired. Reads do not extend its TTL. */
  get(key: string): Promise<V | undefined>;

  /** Store or replace a value, starting a new lifetime using this write's ttlMs. */
  set(key: string, value: V, options: SetOptions): Promise<void>;

  /** Remove a value. Deleting a missing key succeeds without an error. */
  delete(key: string): Promise<void>;

  /**
   * Atomically return and remove a value, or return undefined if the key is absent or expired.
   * At most one caller may consume a stored value. Shared backends must guarantee atomicity across
   * replicas; separate read and delete requests are insufficient.
   */
  consume(key: string): Promise<V | undefined>;
}
