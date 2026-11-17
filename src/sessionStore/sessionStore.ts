/**
 * Public, dependency-free provider contract for session storage.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/sessionStore/sessionStore`)
 * so external deployments can implement a custom session store against a stable type,
 * without importing the server's internal config schemas. Keep it free of runtime dependencies.
 */

/**
 * Session store provider interface.
 *
 * A single logical namespace of short-lived, TTL-bounded values (e.g. pending OAuth
 * authorizations, authorization codes, refresh tokens). The in-memory default keeps
 * everything in process; a custom provider can back these operations with distributed
 * infrastructure (S3/blob storage, Redis, a relational DB) so state survives across
 * horizontally-scaled instances.
 */
export interface SessionStore<V> {
  get(key: string): Promise<V | undefined>;

  /**
   * TTL is not a per-call argument: every call site for a given namespace always uses the
   * same constant (e.g. authorization codes always use `authzCodeTimeoutMs`), so it is
   * configured once, at construction time, per provider/namespace instead of being threaded
   * through every `set` call.
   */
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Atomic get-and-delete: return the current value for `key` (or undefined) and remove
   * it in the same logical operation, so a value can be consumed at most once.
   *
   * For a distributed backend this MUST be truly atomic (e.g. an ETag-based conditional
   * delete for S3/blob storage, a Lua script or MULTI/EXEC for Redis, a transaction for a
   * relational store). The in-memory default gets atomicity for free because Node runs the
   * read and the delete with no `await` between them, but a custom implementation is
   * responsible for guaranteeing no concurrent caller can observe the same value twice.
   */
  consume(key: string): Promise<V | undefined>;

  /**
   * Announce the TTL/bound intended for a given namespace's keys, so a custom provider can
   * apply them itself (e.g. native Redis `EX`/`PEXPIRE` in its own `set`). The
   * in-memory default learns this automatically via per-namespace construction; a custom
   * provider shares one backend across namespaces and otherwise has no way to know which
   * TTL/bound the app computed for which namespace's keys.
   *
   * Optional: a provider that does not implement it is a valid no-op, so existing custom
   * providers keep working. It may be called more than once for the same
   * namespace with identical options, so implementations should treat repeated calls as
   * harmless.
   */
  configureNamespace?(namespace: string, options: { ttlMs: number; maxSize?: number }): void;

  /**
   * Prove the backend is reachable before the server reports healthy (e.g. a Redis `PING`, or
   * establishing a connection pool). Awaited once at startup; if it rejects, boot fails closed
   * rather than opening the port over a store that would 500 on the first OAuth request.
   *
   * Optional: the in-memory default has nothing external to connect to, so it needs neither
   * `init` nor `close`, and existing custom providers without them keep working.
   */
  init?(): Promise<void>;

  /**
   * Release backend resources on shutdown (e.g. close a Redis connection). Awaited from the
   * process's SIGTERM/SIGINT handler. Optional for the same reason as `init`.
   */
  close?(): Promise<void>;
}
