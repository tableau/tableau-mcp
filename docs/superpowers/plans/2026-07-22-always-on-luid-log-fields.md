# Always-on `site_luid` / `user_luid` Log Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `log()` line in tableau-mcp always emits top-level `site_luid` and `user_luid` fields, set once per request, without callers passing them per call.

**Architecture:** Introduce a `Logger` class in `src/logging/logger.ts` that holds lazy LUID getters and merges `site_luid`/`user_luid` into every entry at a single serialization choke point. A module-default `logger` (empty getters → `""`) backs the existing free `log()` for backward compatibility. Per tool call, `server.web.ts` attaches a request-bound child logger (`logger.child({...})`) to `extra`; the 27 request-scoped call sites (+1 audit) log through that bound instance so their lines carry populated LUIDs, while the other 71 sites stay untouched and emit `""`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Zodios/Axios REST layer, MCP SDK.

## Global Constraints

- ESM imports MUST use `.js` extension specifiers (e.g. `import { log } from './logger.js'`).
- Fields are **top-level** keys named exactly `site_luid` and `user_luid` (snake_case, matching existing telemetry at `src/tools/web/tool.ts:230-231`).
- Uniform schema: both keys ALWAYS present on every emitted line; value is the empty string `''` when unknown — never omitted, never a sentinel.
- Injected LUID fields MUST override any caller-supplied `site_luid`/`user_luid` on the entry and MUST NOT mutate the entry's `data`.
- Lazy getters (functions), never snapshot values — PAT/direct-trust backfills LUIDs after sign-in (`src/restApiInstance.ts:131-132`) and later log lines must reflect the backfilled value.
- `AUDIT_LOGGER` entries continue to bypass the severity gate.
- Do NOT modify: the MCP `notifications/message` channel (`src/logging/notification.ts`), the OAuth-handshake/transport tier, or the 26 desktop-variant sites.
- Tests: enhance existing tests where they cover the same component; do not proliferate parallel test files.
- Verification uses `npx vitest run` (NOT `npm test`/watch mode), `npm run lint`, and the build.
- NEVER commit unless the orchestrator/user explicitly authorizes it. Steps below show `git add`/`commit` for the plan record, but the executing team must treat commits as gated on explicit approval.

---

## File Structure

- `src/logging/logger.ts` — **Modify.** Add `Logger` class, module-default `logger`, refactor free `log()` to delegate. Core serialization becomes a private `emit()`.
- `src/logging/types.ts` — **Modify.** Add optional `site_luid`/`user_luid` to a serialized-entry type.
- `src/logging/logger.test.ts` — **Create or enhance** (check for an existing logger test first). Unit tests for the class + backward compat.
- `src/tools/web/toolContext.ts` — **Modify.** Add `logger: Logger` to `TableauWebToolContext`.
- `src/server.web.ts` — **Modify.** Attach `extra.logger = logger.child({...})` in the per-tool-call closure.
- Bucket A files (16 sites) — **Modify.** Swap `log(...)` → `extra.logger.log(...)`.
- `src/restApiInstance.ts` — **Modify.** Widen `RestApiArgs`, thread bound logger into sign-out + interceptor factories.
- Bucket B leaf helpers + `mutationGuard.ts` — **Modify.** Thread bound logger as a parameter.

---

### Task 1: `Logger` class + backward-compatible `log()`

**Files:**
- Modify: `src/logging/logger.ts`
- Modify: `src/logging/types.ts`
- Test: `src/logging/logger.test.ts` (enhance if it exists; else create)

**Interfaces:**
- Produces:
  - `class Logger` with `constructor(getters?: LuidGetters)`, `log(entry: LogEntry): void`, `child(getters: LuidGetters): Logger`.
  - `type LuidGetters = { getSiteLuid?: () => string; getUserLuid?: () => string }` (exported).
  - `const logger: Logger` — module default with empty getters.
  - `function log(entry: LogEntry): void` — delegates to `logger.log(entry)` (unchanged signature).
  - `AUDIT_LOGGER`, `shouldLog`, `parseLogLevel` — unchanged, still exported.

- [ ] **Step 1: Write the failing tests**

Add to `src/logging/logger.test.ts` (create the file with the imports below if none exists). These tests exercise serialization via the `appLogger` stdout path; set env so the app logger is enabled and level allows `info`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log, Logger } from './logger.js';

describe('Logger LUID fields', () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('TRANSPORT', 'http'); // route appLogger to console.log
    vi.stubEnv('ENABLED_LOGGERS', 'appLogger');
    vi.stubEnv('LOG_LEVEL', 'debug');
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const lastLine = (): Record<string, unknown> =>
    JSON.parse(stdout.mock.calls.at(-1)![0] as string);

  it('free log() always emits empty LUID fields', () => {
    log({ message: 'hi', level: 'info', logger: 'test' });
    expect(lastLine()).toMatchObject({ message: 'hi', site_luid: '', user_luid: '' });
  });

  it('bound child logger emits populated LUID fields', () => {
    const bound = new Logger().child({
      getSiteLuid: () => 'site-1',
      getUserLuid: () => 'user-1',
    });
    bound.log({ message: 'hi', level: 'info', logger: 'test' });
    expect(lastLine()).toMatchObject({ site_luid: 'site-1', user_luid: 'user-1' });
  });

  it('reflects lazily backfilled LUIDs (getter value changes after construction)', () => {
    let site = '';
    const bound = new Logger().child({ getSiteLuid: () => site, getUserLuid: () => '' });
    bound.log({ message: 'before', level: 'info', logger: 'test' });
    expect(lastLine()).toMatchObject({ site_luid: '' });
    site = 'site-late';
    bound.log({ message: 'after', level: 'info', logger: 'test' });
    expect(lastLine()).toMatchObject({ site_luid: 'site-late' });
  });

  it('injected LUID fields override caller-supplied values', () => {
    const bound = new Logger().child({ getSiteLuid: () => 'real', getUserLuid: () => 'real-u' });
    bound.log({
      message: 'x',
      level: 'info',
      logger: 'test',
      // @ts-expect-error caller must not be able to spoof LUIDs
      site_luid: 'spoofed',
    });
    expect(lastLine()).toMatchObject({ site_luid: 'real' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/logging/logger.test.ts`
Expected: FAIL — `Logger` is not exported from `./logger.js` (and empty-LUID assertions fail).

- [ ] **Step 3: Add the serialized-entry type**

In `src/logging/types.ts`, after the `LogEntry` definition, add:

```ts
// A LogEntry as serialized to a sink, including the always-on LUID fields the Logger injects.
export type SerializedLogEntry = LogEntry & {
  site_luid: string;
  user_luid: string;
};
```

- [ ] **Step 4: Refactor `logger.ts` to the class + delegate**

In `src/logging/logger.ts`: keep `shouldLog`, `isLogLevel`, `parseLogLevel`, `errorReplacer`, and `AUDIT_LOGGER` exactly as-is. Update the imports to add `SerializedLogEntry`, and replace the exported `log` function with the following (the old body becomes the private `emit`):

```ts
import { getBaseConfig } from '../config.shared.js';
import { getFileLogger } from './fileLogger.js';
import { LogEntry, LogLevel, logLevelSeverity, SerializedLogEntry } from './types.js';

// ... shouldLog / isLogLevel / parseLogLevel / errorReplacer / AUDIT_LOGGER unchanged ...

/** Lazy accessors for the request-scoped identifiers stamped onto every log line. */
export type LuidGetters = {
  getSiteLuid?: () => string;
  getUserLuid?: () => string;
};

/** Emits an already-enriched entry to the configured sinks. This is the former `log()` body. */
function emit(entry: SerializedLogEntry): void {
  const config = getBaseConfig();
  // Audit records always pass the severity gate; all other entries honor the configured level.
  if (entry.logger !== AUDIT_LOGGER && !shouldLog(entry.level, config.logLevel)) {
    return;
  }

  // we are removing any unnecessary fields that may also leak sensitive data
  entry.data = errorReplacer(entry.data);

  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(message);
    } else {
      process.stderr.write(message + '\n');
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}

/**
 * Stamps every log line with the request's site/user LUIDs. The default instance carries empty
 * getters (context-less lines emit ''); a per-request child (see server.web.ts) carries lazy
 * getters so PAT/direct-trust backfill after sign-in is reflected on later lines.
 */
export class Logger {
  constructor(private readonly getters: LuidGetters = {}) {}

  log(entry: LogEntry): void {
    // Injected LUID fields come AFTER the spread so a caller cannot override them, and default to ''.
    emit({
      ...entry,
      site_luid: this.getters.getSiteLuid?.() || '',
      user_luid: this.getters.getUserLuid?.() || '',
    });
  }

  child(getters: LuidGetters): Logger {
    return new Logger(getters);
  }
}

/** Module-default logger for all context-less call sites; emits empty LUID fields. */
export const logger = new Logger();

/** Backward-compatible free function retained for the ~71 context-less call sites. */
export function log(entry: LogEntry): void {
  logger.log(entry);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/logging/logger.test.ts`
Expected: PASS (all 4 new tests).

- [ ] **Step 6: Run lint + typecheck**

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 7: Commit** (only if commits are authorized)

```bash
git add src/logging/logger.ts src/logging/types.ts src/logging/logger.test.ts
git commit -m "Add Logger class with always-on site_luid/user_luid fields"
```

---

### Task 2: Per-request bound logger on the tool context

**Files:**
- Modify: `src/tools/web/toolContext.ts`
- Modify: `src/server.web.ts:64-98` (the `tableauRequestHandlerExtra` object literal)
- Test: `src/logging/logger.test.ts` (already covers the class; the end-to-end binding is verified via Task 3's `logAndExecute` path — no separate test here)

**Interfaces:**
- Consumes: `Logger`, `logger` from Task 1.
- Produces: `TableauWebToolContext.logger: Logger` — every web tool call's `extra` now carries a bound logger.

- [ ] **Step 1: Add `logger` to the context type**

In `src/tools/web/toolContext.ts`, add the import and the field:

```ts
import { Logger } from '../../logging/logger.js';
```

Add to the `TableauWebToolContext` type (after `_siteLuid?: string;`):

```ts
  logger: Logger;
```

- [ ] **Step 2: Bind the child logger in the per-tool-call closure**

In `src/server.web.ts`, import the default logger:

```ts
import { logger } from './logging/logger.js';
```

Inside the `tableauRequestHandlerExtra` object literal (after the `setSiteLuid`/`getSiteName` accessors, before `getConfigWithOverrides`), add:

```ts
          logger: logger.child({
            // Bind the accessors, not values — the LUIDs may be '' until restApi.signIn() backfills
            // them, and lazy getters ensure later log lines pick up the backfilled values.
            getSiteLuid: () => tableauRequestHandlerExtra.getSiteLuid(),
            getUserLuid: () => tableauRequestHandlerExtra.getUserLuid(),
          }),
```

> Note: wrap in arrows referencing `tableauRequestHandlerExtra.getSiteLuid()` rather than passing the method reference directly, to avoid `this`/initialization-order pitfalls with the object literal's own methods.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run lint`
Expected: PASS. If TypeScript complains that `logger` is missing on any `TableauWebToolContext` constructed elsewhere, that construction site must also set it — search `getSiteLuid:` to find sibling context builders and add `logger: logger.child({...})` the same way.

- [ ] **Step 4: Run the web server tests**

Run: `npx vitest run src/server.web.test.ts` (if present) and `npx vitest run src/tools/web/tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add src/tools/web/toolContext.ts src/server.web.ts
git commit -m "Bind a per-request child logger onto the web tool context"
```

---

### Task 3: Convert Bucket A sites (extra in scope, zero threading)

**Files (Modify):**
- `src/tools/web/tool.ts:152` and `:217`
- `src/tools/web/resourceAccessChecker.ts:229,261,329,361,420,452,519,551,583,632`
- `src/tools/web/views/getView.ts:83`
- `src/tools/web/views/listViews.ts:128`
- `src/tools/web/workbooks/getWorkbook.ts:122`
- `src/tools/web/workbooks/listWorkbooks.ts:125`
- Test: `src/tools/web/tool.test.ts` (enhance the existing "tool invoked"/telemetry test to assert LUID fields on the invocation log line)

**Interfaces:**
- Consumes: `extra.logger` from Task 2.

- [ ] **Step 1: Enhance the existing tool.ts test to assert populated LUIDs**

In `src/tools/web/tool.test.ts`, find the test that exercises `logAndExecute` / the "Tool ... invoked" log (it already stubs `getSiteLuid`/`getUserLuid` for telemetry). Add an assertion that the invocation log line carries populated `site_luid`/`user_luid`. Example (adapt to the file's existing spy/mocks):

```ts
// given extra.getSiteLuid() => 'site-A', extra.getUserLuid() => 'user-A'
const invocationLine = logSpy.mock.calls
  .map((c) => JSON.parse(c[0] as string))
  .find((l) => typeof l.message === 'string' && l.message.includes('invoked'));
expect(invocationLine).toMatchObject({ site_luid: 'site-A', user_luid: 'user-A' });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/tools/web/tool.test.ts`
Expected: FAIL — the invocation line still uses the free `log()` (empty LUIDs).

- [ ] **Step 3: Convert the two `tool.ts` sites**

In `src/tools/web/tool.ts`, replace both `log({...})` calls in `logAndExecute` with `extra.logger.log({...})` (identical entry payloads). At `:152`:

```ts
    extra.logger.log({
      message: `Tool ${this.name} invoked: requestId=${requestId}, args=${JSON.stringify(args)}`,
      level: 'debug',
      logger: 'tool',
    });
```

At `:217` (catch block):

```ts
      extra.logger.log({
        message: 'Tool execution failed',
        level: 'error',
        logger: 'tool',
        data: error,
      });
```

Remove the now-unused `log` import from `tool.ts` only if no other `log(` call remains in the file (grep first).

- [ ] **Step 4: Convert the 10 `resourceAccessChecker.ts` sites**

Each of these lives in a method whose params destructure `extra` (e.g. `_isDatasourceAllowed({ ..., extra })`). Replace each `log({...})` with `extra.logger.log({...})`, keeping the payload identical. Lines: 229, 261, 329, 361, 420, 452, 519, 551, 583, 632. Remove the file's `log` import if no free `log(` remains.

- [ ] **Step 5: Convert the 4 lineage sites**

In `getView.ts:83`, `listViews.ts:128`, `getWorkbook.ts:122`, `listWorkbooks.ts:125` — each `log({...})` is inside a callback closing over the tool's `extra`. Replace with `extra.logger.log({...})`, identical payload. Remove each file's now-unused `log` import if applicable.

- [ ] **Step 6: Run tests + lint**

Run: `npx vitest run src/tools/web/tool.test.ts src/tools/web/resourceAccessChecker.test.ts` then `npm run lint`
Expected: PASS (including the enhanced assertion from Step 1).

- [ ] **Step 7: Commit** (only if authorized)

```bash
git add src/tools/web/tool.ts src/tools/web/resourceAccessChecker.ts src/tools/web/views src/tools/web/workbooks src/tools/web/tool.test.ts
git commit -m "Route Bucket A request-scoped logs through the bound logger"
```

---

### Task 4: Thread the bound logger through `restApiInstance.ts`

**Files:**
- Modify: `src/restApiInstance.ts` — `RestApiArgs` (`:51`), sign-out (`:182`, `:184`), interceptor factories `getRequestErrorInterceptor` (`:204`/log at `:207`) and `getResponseErrorInterceptor` (`:243`/log at `:246`), and their call sites (`:109-116`).
- Test: `src/restApiInstance.test.ts` (enhance if present) — assert a sign-out or interceptor error line carries populated LUIDs when a bound logger is supplied.

**Interfaces:**
- Consumes: `Logger`, `logger` (default) from Task 1; `TableauWebToolContext.logger` from Task 2.
- Produces: `RestApiArgs` gains `logger` (via the `Pick`); interceptor factories gain a trailing `boundLogger: Logger` parameter.

- [ ] **Step 1: Widen `RestApiArgs` to carry the bound logger**

In `src/restApiInstance.ts`, add `'logger'` to the `Pick`:

```ts
export type RestApiArgs = Pick<
  TableauWebRequestHandlerExtra,
  'config' | 'server' | 'signal' | 'tableauAuthInfo' | 'setSiteLuid' | 'setUserLuid' | 'logger'
> &
  ( /* ...unchanged disableLogging union... */ );
```

If any synthetic `RestApiArgs` is constructed in tests/helpers without a `logger`, make those pass `logger` (the module default) — grep `RestApiArgs` and `getNewRestApiInstanceAsync(` for construction sites.

- [ ] **Step 2: Add a bound-logger import + local default**

Ensure the file imports the class/default:

```ts
import { log, logger as defaultLogger, Logger } from './logging/logger.js';
```

In `getNewRestApiInstanceAsync`, destructure `logger` from `args` with a fallback:

```ts
  const boundLogger = args.logger ?? defaultLogger;
```

- [ ] **Step 3: Convert the sign-out logs (`:182`, `:184`)**

Replace the two `log({...})` in the sign-out `try/catch` with `boundLogger.log({...})` (identical payloads: `logger: 'auth'`).

- [ ] **Step 4: Thread the bound logger into the interceptor factories**

Change the factory signatures to accept a trailing bound logger and use it for the non-Axios error log:

```ts
export const getRequestErrorInterceptor =
  (server: Server, requestId: RequestId, boundLogger: Logger = defaultLogger): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      boundLogger.log({
        message: `Request ${requestId} failed`,
        level: 'error',
        logger: 'rest-api',
        data: error,
      });
      // ...notifier.error(...) unchanged...
      return;
    }
    // ...unchanged...
  };
```

Apply the same change to `getResponseErrorInterceptor` (log at `:246`, `logger: 'rest-api'`).

- [ ] **Step 5: Pass `boundLogger` at the interceptor call sites (`:109-116`)**

Update the `requestInterceptor`/`responseInterceptor` wiring to pass `boundLogger`:

```ts
    requestInterceptor: disableLogging
      ? undefined
      : [
          getRequestInterceptor(server, args.requestId),
          getRequestErrorInterceptor(server, args.requestId, boundLogger),
        ],
    responseInterceptor: disableLogging
      ? undefined
      : [
          getResponseInterceptor(server, args.requestId),
          getResponseErrorInterceptor(server, args.requestId, boundLogger),
        ],
```

(The success interceptors `getRequestInterceptor`/`getResponseInterceptor` log request/response bodies via `logRequest`/`logResponse`; leave those on the free `log()` — they are debug transport logging, not in the 27-site scope. If desired later, thread them the same way.)

- [ ] **Step 6: Run tests + lint**

Run: `npx vitest run src/restApiInstance.test.ts` then `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit** (only if authorized)

```bash
git add src/restApiInstance.ts src/restApiInstance.test.ts
git commit -m "Thread the request-bound logger through REST sign-out and error interceptors"
```

---

### Task 5: Thread the bound logger through leaf helpers + audit

**Files:**
- Modify: `src/tools/web/users/resolveOwnerEmail.ts:13-35`
- Modify: `src/tools/web/_lib/resolveExtractRefreshTaskTarget.ts:32-91` (+ its 4 callers)
- Modify: `src/tools/web/_lib/deleteContent.ts:611` (+ caller `runDatasourceBranch`)
- Modify: `src/tools/web/contentExploration/searchContent.ts:181` (+ 2 layers to the tool callback)
- Modify: `src/tools/web/adminInsights/resolver.ts:76,85,113` (add a `logger` method param)
- Modify: `src/tools/web/_lib/mutationGuard.ts:279` (+ `guardMutation` passes `extra.logger`)
- Test: enhance the closest existing test per helper (e.g. `deleteContent` / `mutationGuard` suites) to assert a populated LUID line when a bound logger is passed.

**Interfaces:**
- Consumes: `Logger`, `logger` (default), `extra.logger`.
- Convention for these helpers: **keep the existing `logger` string label param renamed to `loggerName`, and add a `boundLogger: Logger = defaultLogger` param.** Emit with `boundLogger.log({ ..., logger: loggerName })`. This preserves each line's `logger:` label while carrying LUIDs.

- [ ] **Step 1: `resolveOwnerEmail.ts`**

Change the signature and body:

```ts
import { logger as defaultLogger, Logger } from '../../../logging/logger.js';

export async function resolveOwnerEmail(
  restApi: RestApi,
  siteId: string,
  ownerId: string | undefined,
  loggerName = 'resolve-owner-email',
  boundLogger: Logger = defaultLogger,
): Promise<string | null> {
  // ...
  } catch (error) {
    boundLogger.log({
      message: `${loggerName}: failed to resolve owner ${ownerId}`,
      level: 'warning',
      logger: loggerName,
      data: getExceptionMessage(error),
    });
    return null;
  }
}
```

- [ ] **Step 2: `resolveExtractRefreshTaskTarget.ts`**

Add `boundLogger` to its param object (default `defaultLogger`), rename its `logger` string field to `loggerName`, emit via `boundLogger.log({ ..., logger: loggerName })` at `:88`, and forward both down to `resolveOwnerEmail(restApi, siteId, ownerId, loggerName, boundLogger)` at the two call sites (`:60`, `:75`). Update its 4 callers (`deleteContent.ts:514`, `updateCloudExtractRefreshTask.ts:215`, `confirmUpdate...:94`, `confirmDeleteContent.ts:212` — all have `extra`) to pass `boundLogger: extra.logger`.

- [ ] **Step 3: `deleteContent.ts:611`**

Thread `extra.logger` from `runDatasourceBranch` (has `extra`) into `describeDownstreamDependencies({..., boundLogger})` and emit the `:611` log via `boundLogger.log({..., logger: 'delete-content'})`.

- [ ] **Step 4: `searchContent.ts:181`**

Thread `extra.logger` from the tool callback → `enrichSearchResultsWithLineage` → `getSearchContentLineage({..., boundLogger})` and emit the `:181` log via `boundLogger.log({..., logger: 'lineage'})`.

- [ ] **Step 5: `adminInsights/resolver.ts`**

`resolveDatasetLuid` is a **cached module-level singleton** — do NOT bind a logger to the object. Add `logger` to its param object and pass it through per call:

```ts
  async resolveDatasetLuid({
    restApi,
    datasetName,
    boundLogger = defaultLogger,
  }: {
    restApi: RestApi;
    datasetName: AdminInsightsDataset;
    boundLogger?: Logger;
  }): Promise<string> {
```

Emit the three logs (`:76,85,113`) via `boundLogger.log({..., logger: RESOLVER_LOGGER})`. Update `executeAdminInsightsQuery` (its caller) to forward `boundLogger: extra.logger` from the tool callback (2 layers).

- [ ] **Step 6: `mutationGuard.ts:279`**

`emitAuditRecord` is called from `guardMutation`, which has `extra` (`:102`) and already builds `MutationActor` from `extra.get*Luid()` at `:128-131`. Pass `extra.logger` into `emitAuditRecord(record, boundLogger)` and emit via `boundLogger.log({ message: 'mutation-audit', level: 'notice', logger: AUDIT_LOGGER, data: fullRecord })`. The top-level `site_luid`/`user_luid` now match the LUIDs already inside `data`.

- [ ] **Step 7: Enhance one helper test to assert populated LUIDs**

In the `mutationGuard` test suite (or `deleteContent`), assert the audit line carries populated `site_luid`/`user_luid` when `extra.logger` is a bound child. Adapt to existing spies:

```ts
const auditLine = logSpy.mock.calls
  .map((c) => JSON.parse(c[0] as string))
  .find((l) => l.message === 'mutation-audit');
expect(auditLine).toMatchObject({ site_luid: 'site-A', user_luid: 'user-A' });
```

- [ ] **Step 8: Run affected suites + lint**

Run: `npx vitest run src/tools/web/_lib src/tools/web/adminInsights src/tools/web/contentExploration src/tools/web/users` then `npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit** (only if authorized)

```bash
git add src/tools/web
git commit -m "Thread the request-bound logger through leaf helpers and the mutation audit"
```

---

### Task 6: Full-suite integration verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Grep audit — confirm scope**

Run: `grep -rn "extra.logger.log\|boundLogger.log" src/ | wc -l`
Expected: ≥ 28 converted sites (16 Bucket A + ~11 Bucket B + 1 audit).

Run: `grep -rn "log(" src/logging/notification.ts src/desktop | grep -v "getFileLogger"`
Expected: desktop + notification sites UNCHANGED (still free `log()` / notification path).

- [ ] **Step 4: Hand off to independent review**

Do NOT commit/PR from here. Report completion with evidence (test/lint/build output) to the orchestrator, which dispatches a FRESH independent-reviewer to re-run verification on the consolidated tree and emit the `VERDICT: PASS`/`FAIL` scorecard before anything lands.

---

## Self-Review

**Spec coverage:**
- Logger class + lazy getters + single merge point → Task 1. ✅
- Uniform schema / empty-string default → Task 1 (Steps 1, 4). ✅
- Backward-compat free `log()` for 71 context-less sites → Task 1 (Step 4). ✅
- Per-request binding in `server.web.ts` + type → Task 2. ✅
- Bucket A (16) → Task 3. ✅
- Bucket B REST (sign-out + interceptors, `RestApiArgs` widen) → Task 4. ✅
- Bucket B leaf helpers (deleteContent, resolveExtractRefreshTaskTarget, resolveOwnerEmail, searchContent, adminInsights) → Task 5. ✅
- Bucket C audit → Task 5 (Step 6). ✅
- Field precedence + no `data` mutation → Task 1 (Step 4 comment + Step 1 override test). ✅
- Out-of-scope guards (notification, desktop, OAuth tier) → Task 6 (Step 3) grep audit + Global Constraints. ✅
- Integration verification + independent-review gate → Task 6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. Line numbers are anchors against `origin/main` @ `97d5c26f` — implementers should confirm by content, not blindly by number.

**Type consistency:** `LuidGetters`, `Logger.child`, `Logger.log`, `SerializedLogEntry`, `RestApiArgs` (+`'logger'`), and the `boundLogger: Logger` / `loggerName: string` helper convention are named identically across Tasks 1–5.

**Note on `logger` naming collision:** leaf helpers historically name their string-label param `logger`. This plan renames it to `loggerName` and reserves `boundLogger` for the `Logger` instance, so no call site conflates a label with an instance.
