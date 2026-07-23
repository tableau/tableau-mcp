# Always-on `site_luid` / `user_luid` log fields

**Date:** 2026-07-22
**Repo:** tableau-mcp
**Status:** Approved design — ready for implementation planning

## Goal

Every log line emitted by tableau-mcp's `log()` facility should carry two top-level
fields, `site_luid` and `user_luid`, so log lines are always attributable to a site and
user without the caller passing them at each call site. The identifiers should be
configured **once per request** and merged automatically into every subsequent log line
in that request.

## Background / current state

- The logger is **not a class**. It is a module-level free function `log(entry)` in
  `src/logging/logger.ts`, imported across ~38 files (99 call sites total). A `LogEntry`
  today is exactly `{ message, data?, level, logger }` (`src/logging/types.ts`); every
  serialized field comes from the single object passed at the call site. There is no
  default-metadata / child-logger / bindings mechanism.
- `log()` serializes with `JSON.stringify(entry)` to stdout (http transport) or stderr
  (stdio), and optionally to a `FileLogger` singleton. `AUDIT_LOGGER` entries bypass the
  level gate.
- `site_luid` / `user_luid` are **not** on any log line today. They live on the
  per-request tool context `TableauWebToolContext` / `TableauWebRequestHandlerExtra`
  (`src/tools/web/toolContext.ts`), exposed via `getSiteLuid()` / `getUserLuid()`. That
  context is constructed fresh per tool call in `src/server.web.ts` (~lines 64–98).
- The LUIDs resolve lazily with a fallback chain: from parsed auth info
  (`getTableauAuthInfo(extra.authInfo)`), or — for PAT / direct-trust — backfilled **after
  `restApi.signIn()`** via `setSiteLuid` / `setUserLuid` (`src/restApiInstance.ts:131-132`).
  So values may be unknown at the start of a request and become known mid-request.
- There is **no** `AsyncLocalStorage` / ambient context in the codebase today.

### Call-site map (99 total)

| Bucket | Count | Description |
|---|---|---|
| A — request-scoped, `extra` in scope | 16 | `logAndExecute` (every tool invocation + failure), `resourceAccessChecker` denials, 4 lineage sites. Zero threading. |
| B — request-scoped, `extra` NOT in scope | 11 | REST sign-out (182/184), REST interceptors (207/246), `deleteContent` (611), `resolveExtractRefreshTaskTarget` (88), `resolveOwnerEmail` (27), `searchContent` lineage (181), `adminInsights/resolver` (76/85/113). Threading depth 0–2 layers. |
| C — audit | 1 | `mutationGuard.ts:279`. Record already embeds LUIDs; `extra` 1 layer up in `guardMutation`. |
| D — context-less | 71 | Startup, telemetry/feature-gate init, session lifecycle, logging infra, OAuth handshake, transport, and 26 desktop-variant sites (no web-LUID concept; never run in hosted deployment). No user exists → empty. |

**28 non-context-less sites (A + B + C)** get populated LUIDs: the **27 request-scoped**
sites (Buckets A + B) plus the **1 audit** line (Bucket C, whose record already embeds the
LUIDs). The other 71 (Bucket D) carry the keys with `""` — correct, since no user/site
exists at those points.

## Decisions

1. **Class over AsyncLocalStorage.** Use an explicit, threaded `Logger` instance rather
   than ambient context. (User preference; more traceable, no implicit magic.)
2. **Uniform schema.** Every log line always emits both keys; value is `""` when unknown
   (not omitted, not a sentinel).
3. **Lazy getters, not snapshot values.** The bound logger holds getter *functions*, so
   PAT-auth backfill (`setSiteLuid`/`setUserLuid`) is reflected on later log lines
   automatically.
4. **Populate all 27 request-scoped sites** (plus the 1 audit line = 28 total), accepting
   the deeper threading (REST interceptors, 2-layer lineage/adminInsights helpers).
5. **Repo:** tableau-mcp, not tabhf-mcp-svc. tabhf-mcp-svc spawns tableau-mcp as a
   subprocess and only reverse-proxies raw bytes + tails the child's stdout as opaque
   strings; it has no logger, no LUIDs, and no request correlation for child log lines.
   Enriching there is infeasible and would still miss the tool-invocation lines.

## Design

### 1. `Logger` class — `src/logging/logger.ts`

- Wraps today's serialization logic (level gate → `errorReplacer` → app-logger
  `JSON.stringify` + `getFileLogger().log()`).
- Constructor takes `{ getSiteLuid?: () => string, getUserLuid?: () => string }`.
  Both optional; when absent, treated as returning `""`.
- On each log, merges `site_luid` and `user_luid` as **top-level keys** on the entry
  (each defaulting to `""` when the getter is absent or returns falsy), then runs the
  existing sink logic. The merge happens in exactly **one place** so the app logger, file
  logger, and audit path all get the fields uniformly.
- `.child(getters)` returns a new bound `Logger` instance.
- Method surface: `.log(entry)` at minimum; `.info()/.error()` convenience wrappers only
  if they reduce churn at converted call sites (otherwise keep `.log`).

**Field precedence / collision:** `site_luid`/`user_luid` are injected by the logger and
must not be overridable by a caller's `entry` (guard against a call site that already sets
them). The audit record at `mutationGuard.ts:279` embeds LUIDs inside `data`; the new
top-level fields are separate and must not collide with or mutate `data`.

### 2. Backward compatibility

- `export const logger = new Logger()` — module default with no getters → emits `""`.
- The existing free `log(entry)` becomes a one-line delegate to `logger.log(entry)`.
- **All 71 context-less/handshake/desktop sites stay untouched** and emit
  `site_luid: ""`, `user_luid: ""`. No churn there.

### 3. Per-request binding — `src/server.web.ts` (~64–98)

Where `extra` is constructed per tool call, attach a bound child:

```ts
extra.logger = logger.child({
  getSiteLuid: extra.getSiteLuid,
  getUserLuid: extra.getUserLuid,
});
```

Add `logger: Logger` to `TableauWebToolContext` (`src/tools/web/toolContext.ts`).

### 4. Convert the 27 request-scoped sites

- **Bucket A (16) — swap in place:** `log(...)` → `extra.logger.log(...)`. `extra` already
  in scope. Sites: `tool.ts` 152 & 217 (`logAndExecute` — covers every tool invocation +
  failure), `resourceAccessChecker.ts` (229/261/329/361/420/452/519/551/583/632),
  `getView.ts:83`, `listViews.ts:128`, `getWorkbook.ts:122`, `listWorkbooks.ts:125`.
- **Bucket B (11) — thread the bound `Logger` instance down as a parameter.** These leaf
  helpers today take a `logger:` **label string**; change them to take the bound `Logger`
  instance and call `.log({ ..., logger: '<label>' })`, preserving the existing label.
  - `restApiInstance.ts` 182/184 — widen `RestApiArgs` (the `Pick`) to carry the bound
    logger (getters already present at runtime via `...extra` spread).
  - `restApiInstance.ts` 207/246 — pass the bound logger into the interceptor factory /
    `RestApi` constructor (deepest threading).
  - `deleteContent.ts:611` — 1 layer (caller `runDatasourceBranch` has `extra`).
  - `resolveExtractRefreshTaskTarget.ts:88` — 1 layer, 4 callers.
  - `resolveOwnerEmail.ts:27` — 1–2 layers.
  - `searchContent.ts:181` — 2 layers.
  - `adminInsights/resolver.ts` 76/85/113 — 2 layers.
- **Bucket C (1) — `mutationGuard.ts:279`:** bind through from `guardMutation` (extra 1
  layer up). Record already embeds LUIDs; now the log line's top-level fields match.

### 5. Testing

Follow the repo convention (enhance existing tests, don't proliferate new ones):

- Enhance existing logger tests to assert **both keys are always present** and default to
  `""` for the plain `log()` / default logger.
- Add a bound-logger test: populated getters → populated fields; **lazy backfill** — a
  getter whose underlying value changes after construction (mirroring
  `setUserLuid`/`setSiteLuid`) is reflected on the next log line.
- Assert the injected fields cannot be overridden by a caller-supplied `entry` and don't
  mutate `data`.
- Verify one representative Bucket A site (`logAndExecute`) and one Bucket B site (a REST
  interceptor or a threaded helper) end-to-end.

## Out of scope

- The separate MCP `notifications/message` channel (`src/logging/notification.ts`) — not
  `log()`.
- The OAuth-handshake / transport tier (~22 sites) — would require a new auth-layer
  per-connection context seam and a check that token claims carry `siteId`/`userId`
  pre-sign-in. Deferred.
- The 26 desktop-variant sites — no web-LUID concept; never execute in the hosted
  deployment.

## Verification / done criteria

- Every `log()` line emits `site_luid` and `user_luid` keys (empty string when unknown).
- All 27 request-scoped sites emit populated LUIDs for an authenticated request, including
  PAT/direct-trust where values are backfilled after sign-in.
- Full suite green on the integrated tree: `npx vitest run`, `npm run lint`, build.
- Independent-reviewer `VERDICT: PASS` on the consolidated worktree before any commit/PR.
