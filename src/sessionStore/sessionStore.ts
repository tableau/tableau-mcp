/**
 * Public, dependency-free contract for OAuth session storage.
 *
 * Exported at @tableau/mcp-server/sessionStore/sessionStore so custom providers can
 * implement session operations, namespace policies, and optional lifecycle hooks.
 */
export interface SessionStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomically return and remove a value, so at most one caller can consume it. */
  consume(key: string): Promise<V | undefined>;

  configureNamespace?(namespace: string, options: { ttlMs: number; maxSize?: number }): void;
  init?(): Promise<void>;
  close?(): Promise<void>;
}
