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
   * through every `set`/`rotate` call.
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
   * Atomic rotate: delete `oldKey` and set `newKey` to `value` in the same logical
   * operation, so there is never a window in which both keys are simultaneously valid
   * (used for OAuth refresh-token rotation).
   *
   * As with `consume`, a distributed backend MUST make this truly atomic (conditional
   * write, Lua script/MULTI-EXEC, or a DB transaction). The in-memory default is atomic
   * because there is no `await` between the delete and the set.
   *
   * `rotate` is declared TypeScript-optional only so that a trivial delete-then-set
   * fallback body is a valid implementation to write. This repo's loader nonetheless
   * treats `rotate` as REQUIRED for custom providers (validation fails if it is absent),
   * because the OAuth refresh-token rotation call sites invoke it directly with no runtime
   * branching on whether it exists.
   */
  rotate?(oldKey: string, newKey: string, value: V): Promise<void>;
}
