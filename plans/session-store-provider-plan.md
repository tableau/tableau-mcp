# SessionStore for the Embedded OAuth Authorization Server

## Context

The design doc "Horizontal Scalability & Durability for the tableau-mcp Embedded OAuth Authorization Server" identifies two real problems with `EmbeddedOAuthProvider` (used when `config.oauth.embeddedAuthzServer` is on): the OAuth 2.1 flow spans multiple HTTP requests (`/oauth2/authorize` → `/Callback` → `/oauth2/token`) that a load balancer can route to different replicas, but all session state lives in five process-local in-memory maps — so multi-replica deployments break, and even a single-instance restart/deploy silently wipes in-flight logins and forces every client to re-authenticate.

The doc's fix is the standard AS pattern: make instances stateless by moving session state behind a swappable `SessionStore` interface, defaulting to the current zero-dependency in-memory behavior, with real backends (Redis/DB) as an opt-in a deployer brings themselves. tableau-mcp already has this exact "pluggable provider, bring your own infra" shape twice in production (`FeatureGateProvider`, `TelemetryProvider`) and once in-flight (`UploadUrlProvider`, PR #800) — same three-piece recipe: public interface + default built-in implementation + a `<X>_PROVIDER`/`<X>_PROVIDER_CONFIG` env-var-driven loader that `require()`s a custom module. This plan continues that same pattern, scoped to the **required parts only**: the interface, the default in-memory implementation, and rewiring `EmbeddedOAuthProvider`'s five maps onto it. It does **not** ship a Redis/DB implementation — that's downstream, exactly like `UploadUrlProviderImpl` was built by tabhf-mcp-svc after tableau-mcp shipped just the interface.

Work happens in a fresh git worktree off a new branch (`.worktrees/session-store-provider` or similar — use the `new-branch` skill for exact naming convention), since this is a self-contained cross-cutting change isolated from other in-flight tableau-mcp work (Phase 2 embed-token-resolver, TelemetryProvider tracing, etc.).

## Approach

### 1. New package `src/sessionStore/` (mirrors `src/features/` file-for-file)

- **`sessionStore.ts`** — public interface, exported as a types-only package subpath (like `featureGateProvider.ts`):
  ```ts
  export interface SessionStore<V> {
    get(key: string): Promise<V | undefined>;
    set(key: string, value: V, ttlMs: number): Promise<void>;
    delete(key: string): Promise<void>;
    consume(key: string): Promise<V | undefined>; // atomic get-and-delete
    rotate?(oldKey: string, newKey: string, value: V, ttlMs: number): Promise<void>; // atomic delete-old+set-new
  }
  ```
  Doc-comment must state: for a distributed backend, `consume`/`rotate` must be truly atomic — e.g. an ETag-based conditional write (`If-Match`) for an S3/blob-storage backend, a Lua script/`MULTI`/`EXEC` for Redis, or a DB transaction for a relational store. The in-memory default gets this for free since Node has no `await` between the read and the delete, but a custom implementation is responsible for real atomicity. Also state that `rotate` is marked optional only so a trivial `delete`+`set` fallback body is a valid implementation — **this repo's loader treats it as required for custom providers** (see `init.ts` below), since `token.ts`'s refresh-rotation call sites always call it directly with no runtime branching.

- **`types.ts`** — config schema, mirrors `src/features/types.ts` exactly: `sessionStoreProviderSchema = z.enum(['memory', 'custom'])`, `isSessionStoreProvider` guard, `memorySessionStoreConfigSchema`, `providerConfigSchema` (`{module: string}.passthrough()`), `customSessionStoreConfigSchema`, discriminated union `sessionStoreConfigSchema`, `SessionStoreConfig` type.

- **`inMemorySessionStore.ts`** (mirrors `serverFeatureGate.ts`) — `InMemorySessionStore<V>` **composes** (does not extend) one `ExpiringMap<string, V>` (`src/utils/expiringMap.ts`) internally:
  - `get`/`set(key, value, ttlMs)`/`delete` — thin `Promise.resolve()`-wrapped pass-throughs. `set` always receives an explicit `ttlMs` per call (the `ExpiringMap` ctor's `defaultExpirationTimeMs` becomes an unused-in-practice placeholder, required only because the ctor throws on `<= 0`).
  - `consume(key)` — `get` then `delete` with no `await` between them (single JS tick), returning the pre-delete value.
  - `rotate(oldKey, newKey, value, ttlMs)` — `delete(oldKey)` then `set(newKey, value, ttlMs)`, implemented eagerly (never left `undefined`) for exact parity with today's manual delete+set pairs in `token.ts`.
  - Constructor takes `{ maxSize?: number }`, passed straight through to `ExpiringMap` — only the `clientRegistration` namespace uses `maxSize: 10_000` today; the other four stay unbounded, matching current behavior. `maxSize` is NOT part of the `SessionStore` interface — it's `InMemorySessionStore`-specific; a custom backend manages its own bounding.

- **`init.ts`** (mirrors `src/features/init.ts`):
  - `validateSessionStore(provider)` — duck-types `get`/`set`/`delete`/`consume` **and `rotate`** as required functions (unlike the TS-level `?`, loader-level validation requires it — fail fast with `Custom provider missing required method: rotate` if absent).
  - `initializeSessionStore()` — reads `config.sessionStore`; `'custom'` → `loadCustomProvider(config)` (same resolve/require/instantiate/validate logic as `features/init.ts`'s `loadCustomProvider`); `'memory'`/default/error-fallback → an internal marker meaning "use `InMemorySessionStore` per namespace." Stores either `{ kind: 'memory' }` or `{ kind: 'custom', store: SessionStore<unknown> }` as the module singleton.
  - `createNamespacedStore<V>(namespace: string, options?: { maxSize?: number }): SessionStore<V>` — the one new piece beyond the `features`/`telemetry` precedent, because this doc explicitly recommends **one configured backend for all five states, not five independently-configured ones** (simpler for a deployer to operate — one Redis connection, one config block). When `kind === 'memory'`, returns a **fresh `InMemorySessionStore<V>(options)` per call** (no cross-namespace sharing needed — `EmbeddedOAuthProvider`'s constructor calls this exactly once per field, so no extra memoization layer is needed and none should be added, since a module-level memoized singleton would leak state across test instances that each construct their own `EmbeddedOAuthProvider`). When `kind === 'custom'`, returns a key-prefixing wrapper (`` `${namespace}:${key}` ``) around the single shared custom `store`, so one physical backend legitimately backs all five namespaces without cross-namespace key collisions.
  - Namespace constants: `'pendingAuthorization'`, `'authorizationCode'`, `'refreshToken'`, `'refreshTokenIndex'`, `'clientRegistration'` — export from `init.ts` (or `types.ts`) as a const to avoid typos at call sites.
  - `resetSessionStore()` — test-only reset hook, mirrors `resetFeatureGate()`.

### 2. Config wiring — `src/config.ts`

Mirror the existing `featureGate` block: new `sessionStore: SessionStoreConfig` field, env vars `SESSION_STORE_PROVIDER` (`memory`|`custom`, default `memory`) / `SESSION_STORE_PROVIDER_CONFIG` (JSON `{module: string}`), same "custom requires providerConfig, parse via schema, throw if malformed" logic as the `featureGate` parsing block (~`config.ts:296`).

### 3. Startup wiring — `src/index.ts`

Add `initializeSessionStore()` next to the existing `initializeFeatureGate()` call, so it runs before `startExpressServer()` constructs `EmbeddedOAuthProvider`.

### 4. `src/server/oauth/provider.ts`

Replace the five field declarations (currently lines 58–67: four raw `Map`s + one `ExpiringMap`) with:
```ts
private readonly pendingAuthorizations: SessionStore<PendingAuthorization> = createNamespacedStore('pendingAuthorization');
private readonly authorizationCodes: SessionStore<AuthorizationCode> = createNamespacedStore('authorizationCode');
private readonly refreshTokens: SessionStore<RefreshTokenData> = createNamespacedStore('refreshToken');
private readonly refreshTokenIndex: SessionStore<string> = createNamespacedStore('refreshTokenIndex');
private readonly clientRegistrations: SessionStore<ClientRegistration> = createNamespacedStore('clientRegistration', { maxSize: 10_000 });
```
Drop the `ExpiringMap`/`milliseconds.fromDays(24)` import and usage from this file (the 24-day TTL constant moves to `register.ts`'s `set(...)` call, `maxSize` moves to the `createNamespacedStore` call above). `setupRoutes()` (lines 83–104) keeps passing these five fields into `register`/`authorize`/`callback`/`token`/`revoke` unchanged — only the handler *signatures* change (`Map<K,V>`/`ExpiringMap<K,V>` → `SessionStore<V>`, keys are already `string` everywhere).

### 5. Handler files — `src/server/oauth/{authorize,authorizeRedirectUri,callback,token,revoke,register}.ts`

- **`authorizeRedirectUri.ts`**: `checkRedirectUriAllowed` becomes `async`; `clientRegistrations.get(clientId)` → `await ...get(clientId)`. Update its test + `authorize.ts`'s call site to `await`.
- **`authorize.ts`**: `pendingAuthorizations.set(authKey, {...})` → `await ...set(authKey, {...}, config.oauth.authzCodeTimeoutMs)`, and **delete** the existing `setLongTimeout(() => pendingAuthorizations.delete(authKey), ...)` manual-expiry block entirely — the store now owns expiry via the `ttlMs` argument. Remove the now-unused `setLongTimeout` import if nothing else in the file needs it.
- **`callback.ts`**: keep the existing `get` (early, for `tableauState` validation) as `await ...get(authKey)`, and the existing cleanup `.delete(authKey)` (success path only) as `await ...delete(authKey)`. **Do not** collapse this into `consume()` — several early-return error paths (invalid state, token-exchange failure, site mismatch) intentionally leave the pending authorization in place today so a client can retry the callback after a transient failure; `consume()` would silently remove that retry behavior. `authorizationCodes.set(...)` → `await ...set(authorizationCode, {...}, config.oauth.authzCodeTimeoutMs)`, keep the existing `expiresAt` field on the stored value (belt-and-suspenders app-level check, independent of store TTL).
- **`token.ts`**: authorization-code grant — collapse the existing get+delete pair into one `await authorizationCodes.consume(code)` (this one genuinely is single-use, no retry semantics, RFC-required exactly-once use). Refresh-token issuance — `refreshTokens.set(...)`/`refreshTokenIndex.set(...)` gain explicit `ttlMs = config.oauth.refreshTokenTimeoutMs`, and their paired `setLongTimeout(...delete...)` manual-expiry blocks are deleted. Refresh-token rotation — replace the existing delete-old+set-new pairs for both `refreshTokens` and `refreshTokenIndex` with `await store.rotate(oldKey, newKey, value, ttlMs)` calls. Invalid/expired early-return cleanup stays plain `await ...delete(...)`.
- **`revoke.ts`**: `tryRevokeRefreshToken`/`tryRevokeAccessToken` become `async`; use `refreshTokens.consume(token)` for the revoke-read (no retry semantics needed — consuming an already-gone key just returns `undefined`, preserving RFC 7009's "unknown token → 200"). All `.delete()` calls become `await`.
- **`register.ts`**: handler becomes `async`; `clientRegistrations.set(clientId, {...})` → `await ...set(clientId, {...}, milliseconds.fromDays(24))` (the TTL constant that used to live in `provider.ts`'s `ExpiringMap` ctor now lands here).

### 6. Tests

New unit tests (mirror `src/features/init.test.ts` and `src/utils/expiringMap.test.ts` style):
- `src/sessionStore/inMemorySessionStore.test.ts` — get/set/delete/consume/rotate semantics, TTL expiry via fake timers, `maxSize` pass-through, delete-on-missing-key is a no-op.
- `src/sessionStore/init.test.ts` — default `memory` provider; custom provider load (happy path + missing `module`/missing methods including `rotate`); `createNamespacedStore` prefix isolation between two namespaces sharing one custom backend; confirm the `memory` path does NOT share state across separate `createNamespacedStore` calls for the same namespace (no accidental module-level singleton leaking across `EmbeddedOAuthProvider` instances / test cases).

Existing integration tests (`tests/oauth/embedded-authz/*.test.ts`) must continue to pass unmodified against the new default — each test's `beforeEach` constructs a fresh `EmbeddedOAuthProvider`, and since `createNamespacedStore` builds a fresh `InMemorySessionStore` per field per instance (not a module-global), per-test isolation is preserved exactly as today. Run the full `tests/oauth/embedded-authz` suite after each handler file is converted (not just once at the end) to catch regressions early — start with `register.ts`/`authorizeRedirectUri.ts` as leaf dependencies, then `authorize.ts`/`callback.ts`/`token.ts`/`revoke.ts`.

### 7. Docs + package export

- `docs/docs/configuration/mcp-config/env-vars.md`: add `SESSION_STORE_PROVIDER`/`SESSION_STORE_PROVIDER_CONFIG` sections immediately after the existing `FEATURE_GATE_PROVIDER` sections, same structure (default, values, `:::tip[Custom Provider]` example, link to the interface source).
- Enterprise docs (wherever the existing `FeatureGateProvider`/`TelemetryProvider` "bring your own infra" recipe subsection lives, e.g. `docs/docs/enterprise/tableau-cloud.md`/`tableau-server.md`): add a matching `SessionStore` subsection stating this only matters for `OAUTH_EMBEDDED_AUTHZ_SERVER=true` multi-replica/durability-sensitive deployments, the one-backend-for-five-namespaces model, and the atomicity requirement on `consume`/`rotate`. Use an S3/blob-storage-backed provider as the suggested reference implementation in the docs' example (matching this org's existing S3 usage pattern from `UploadUrlProvider`), and call out its two real gaps explicitly so a deployer isn't surprised: (a) S3 lifecycle rules are day-granularity, so the short-lived namespaces (`pendingAuthorization`, `authorizationCode`, minutes-scale TTL) need an app-level sweeper/cron to actually delete expired objects, not just the app-level `expiresAt` check as a backstop; (b) `consume`/`rotate` need an ETag-based conditional-write scheme (`If-Match` on delete/put) to approximate atomicity, since S3 has no native atomic get-and-delete. No concrete backend implementation ships in this PR either way.
- `package.json`: add `"./sessionStore/sessionStore": { "types": "./build/sessionStore/sessionStore.d.ts" }` to `exports` (alongside `./features/featureGateProvider`, `./telemetry/telemetryProvider`), and bump the minor version per repo convention for a new public export (matches the `UploadUrlProvider` PR #800 precedent of bumping on new export subpaths).

### Explicitly out of scope

- No S3/blob-storage (or Redis/DB) `SessionStore` implementation (downstream consumer's job, same split as `UploadUrlProvider`/`UploadUrlProviderImpl`) — the docs example references S3 as the *suggested* reference implementation, but nothing is built here.
- No load-balancer/sticky-session configuration.
- No latency benchmarking of the new `await`-based hot path (doc's open question 4) — real numbers only make sense once a real custom backend exists to measure, and an S3-backed store in particular (higher per-call latency + per-request cost than Redis/DB) would be the first thing worth benchmarking.
- No changes to `ExpiringMap` itself beyond continuing to use it inside `InMemorySessionStore`.

### Critical files

- `src/server/oauth/provider.ts` (field declarations + `setupRoutes` wiring)
- `src/server/oauth/{authorize,authorizeRedirectUri,callback,token,revoke,register}.ts` (call-site conversions)
- `src/features/types.ts`, `src/features/init.ts`, `src/features/serverFeatureGate.ts` (the pattern being mirrored)
- `src/utils/expiringMap.ts` (wrapped by the new default implementation)
- `src/config.ts` (new `sessionStore` field/env vars, mirrors existing `featureGate` block)
- `src/index.ts` (add `initializeSessionStore()` call)
- `tests/oauth/embedded-authz/*.test.ts` (regression suite to run after each handler conversion)

## Verification

1. `npx vitest run src/sessionStore` — new unit tests for the interface, `InMemorySessionStore`, and the loader/factory pass.
2. `npm run test:oauth:embedded` (or `npx vitest run -c vitest.config.oauth.embedded.ts`) — full existing embedded-OAuth integration suite passes unmodified against the new default, including TTL-expiry tests, RFC 7009 unknown-token-200 tests, and refresh-token-rotation consistency tests.
3. `npm test` — full unit suite green, no regressions in `src/features`/`src/telemetry` (pattern untouched) or `src/utils/expiringMap.test.ts`.
4. `npm run build` and `npx tsc` clean (async signature changes ripple through several files — must typecheck end to end).
5. Manual sanity: start the HTTP server with `OAUTH_EMBEDDED_AUTHZ_SERVER=true` (default `SESSION_STORE_PROVIDER=memory`) and run through one real authorize→callback→token→refresh→revoke cycle to confirm no behavioral regression outside the automated suite.
