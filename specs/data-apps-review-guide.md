# Data-Apps PR Review Onboarding Guide

> For devs who are **not** MCP experts but have to review PRs in the `tableau-mcp` data-apps
> subsystem. Companion to [`data-app-allowed-origins.md`](./data-app-allowed-origins.md), which is
> the worked example in §9.

## 1. Who this is for / how to use it

You're a competent TypeScript dev who is **not** an MCP expert and has to review PRs in the
data-apps subsystem. This guide gives you just enough mental model to be dangerous, then a
file-anchored checklist you run top-to-bottom. Read sections 2–6 once; on every PR, jump straight to
the **checklist (§8)** and the **invariants (§4)** — those are where the silent, high-cost bugs live.

---

## 2. The 60-second mental model

- **MCP (Model Context Protocol):** the wire protocol by which an LLM discovers and calls
  server-side functions. This server exposes Tableau capabilities to an LLM.
- **A "tool":** a named function the model invokes by emitting a JSON args object. The MCP SDK
  validates those args against the tool's Zod schema *before* the callback runs. **The tool's
  `description` and every field's `.describe(...)` string are prompts the model reads** — wording is
  behavior, not comments.
- **A "data app":** an HTML/JS/CSS bundle that Tableau hosts as a *viz (worksheet) extension* inside
  a published `.twbx` workbook. It runs in a **sandbox under a strict CSP** — it can only
  `fetch`/XHR/WebSocket to origins declared in its package manifest.
- **A "workspace":** a server-managed, per-actor-scoped bag of source files for one data app.
  Referenced publicly only by an opaque `appId`. Never by path.

**The publish pipeline (one diagram):**

```
scaffold-data-app        creates workspace + scaffold (index.html, src/app.js,
   │                       src/styles.css, dataapp.json). Only data-app tool that queries VDS.
   ▼
author loop:
   read / list / search-data-app-file      inspect (read-only, no REST)
   upsert-data-app-files                    rewrite whole files (atomic batch)
   patch-data-app-file                      anchored find/replace
   └─ both write tools also carry optional allowedOrigins → updateManifestAllowedOrigins
   ▼
validate-workbook-package    packages workspace → .twbx, runs checks,
   │                          stores IMMUTABLE bytes under an opaque validationId (receipt)
   ▼
create-and-publish-workbook  uploads the EXACT validated bytes (never rebuilds from source)
   ▼
edit-data-app                reopen: REST download of published workbook (workbooks:download),
                             reconstruct workspace (NEW appId), re-enter author loop
```

Everything is partitioned by **scope** (`{server, siteId, actorId}`), derived only from
server-verified request signals, never from tool arguments. `dataapp.json` is a **protected
manifest** that only one sanctioned writer may touch.

> REST/VDS at a glance: `scaffold-data-app` is the only tool that queries **VDS** (to validate
> datasources); `edit-data-app` is the only *other* data-app tool that hits **REST** (it downloads
> the published workbook, `editDataApp.ts:118`). The rest of the author loop touches neither.

---

## 3. The subsystem map

| Area | What it does | Key files | When a PR touches this, check… |
|---|---|---|---|
| **MCP tool layer** | Defines/registers each tool: name, description (prompt), Zod schema (API), scopes, callback. | `src/tools/tool.ts`, `src/tools/web/tool.ts`, registration `src/server.web.ts:52-246`, names/groups `src/tools/web/toolName.ts`, scopes `src/server/oauth/scopes.ts`, context `src/tools/web/toolContext.ts` | New tool wired into **all** of: `webToolFactories` (`tools.ts:54`), `webToolNames` (`toolName.ts`), correct `webToolGroups`, `toolScopeMap` (`scopes.ts` — a missing entry throws at construction). Feature-gate coupling (`server.web.ts:155`). |
| **dataApps core / store** | Provider-agnostic storage. Scope derivation, opaque IDs, protected-file rules, containment. | `src/dataApps/workspaceStore.ts`, `fileSystemWorkspaceStore.ts`, `workspaceScope.ts`, `opaqueId.ts`, `types.ts`, `init.ts` | Scope from server-verified signals only (`workspaceScope.ts:44`); `hashScope` inputs unchanged; every id→path routes through `parseOpaqueId`; `src/dataApps/` does **not** import from `src/tools/`. |
| **dataApps tools** | The lifecycle tools + shared scope/manifest helpers. | `scaffoldDataApp.ts`, `upsertDataAppFiles.ts`, `patchDataAppFile.ts`, `read/list/searchDataAppFile.ts`, `editDataApp.ts`, `scopeFromExtra.ts`, `manifestOrigins.ts` | Scope resolved via `resolveScopeFromExtra(extra)` first; never a scope-shaped param. Protected-manifest guard runs **before** store resolution. Manifest changes route through `updateManifestAllowedOrigins`. |
| **Packaging** | Turns workspace → `.twbx`; the inverse for reopen. Byte-stable. | `buildTwbx.ts`, `buildWorkspaceTwbx.ts`, `reconstructWorkspaceFromTwbx.ts` | Determinism (`FIXED_MTIME`, deterministic hashing); `manifest.json` `id` == `Packages/<id>/` folder; round-trip recovers every shippable field; `dataapp.json` never shipped as content. |
| **Validation** | The publish choke point: builds, runs checks, issues receipt. | `validateWorkbookPackage.ts`, `assetReferenceCheck.ts` (hard), `undeclaredOriginsCheck.ts` (advisory), `packageValidation.contract.test.ts` (drift guard) | New checks sorted into the right bucket (advisory vs hard); receipt = immutable bytes; `checksPerformed` accurate. |

---

## 4. The invariants that fail silently

**This is the highest-value section.** Each of these has *no loud failure* — tests stay green,
publish succeeds, breakage surfaces only at runtime in a console-less sandbox or as silent data
loss. For each: what it is, why it's dangerous, and the ONE diff pattern that signals risk.

### 4.1 Byte-stability / determinism
- **What:** identical input → byte-identical `.twbx` / manifest output. A no-origins app must
  produce a `dataapp.json` **byte-identical to the pre-feature scaffold**. Enforced by `FIXED_MTIME`
  (`buildTwbx.ts:36`), deterministic hashing (`:268-295`), and "emit `allowedOrigins` **last**, only
  when trimmed-non-empty" in both manifests (`templates.ts:89-92`, `buildTwbx.ts:192-195`).
- **Why dangerous:** the receipt→publish digest match and every golden/determinism test assume
  stable bytes. A stray key or whitespace change won't error — it silently invalidates goldens and
  means the feature isn't inert when unused.
- **Diff red flag:** a manifest field emitted *unconditionally* (even when empty, e.g.
  `"allowedOrigins": ""`), inserted mid-object, reordered, or any change to indentation / trailing
  newline (`null, 2` + `\n`). Any always-present, time-based, or unsorted new field.

### 4.2 Protected manifest — single sanctioned writer (two guards)
- **What:** `dataapp.json` is protected on **two** layers. (1) **Store layer:** it's in
  `PROTECTED_WORKSPACE_FILES` (`fileSystemWorkspaceStore.ts:60`); ordinary `upsertFiles` rejects it
  (`validateBatch(..., {allowProtected:false})`, throws `UnsafeWorkspacePathError` at `:456`). Only
  `create` (`:133`) and `writeManifest` (`:214`, `:225`) pass `allowProtected:true`, and
  `writeManifest` writes only the one hard-coded path — never a caller value. (2) **Tool layer:** the
  write tools independently reject `dataapp.json` via `isProtectedManifestPath` *before* touching the
  store (`upsertDataAppFiles.ts:93-98`, and the equivalent in `patchDataAppFile.ts`) — this is the
  real defense when a custom/hosted store provider is swapped in.
- **Why dangerous:** if the model could overwrite the manifest via a normal file write, it could
  corrupt datasource bindings or the allow-list.
- **Diff red flag:** a third caller with `allowProtected:true`; `upsertFiles` flipped to `true`;
  `writeManifest` writing to `content.path` instead of the literal `WORKSPACE_MANIFEST_FILENAME`; the
  manifest removed from `PROTECTED_WORKSPACE_FILES`; the tool-layer `isProtectedManifestPath` guard
  removed (especially in a store-provider swap PR); a new protected file added but left writable via
  upsert.

### 4.3 Scope isolation (cross-tenant)
- **What:** storage is partitioned by `hashScope(scope)` = SHA-256 of `server\0siteId\0actorId`
  (`fileSystemWorkspaceStore.ts:610`). Scope derives only from server-verified signals via
  `resolveWorkspaceScope` (`workspaceScope.ts:44`) / `resolveScopeFromExtra` (`scopeFromExtra.ts:15`).
  `actorId` is `user:…` / `session:…` / `local-stdio` — never a raw token. Every read re-checks
  `meta.scopeHash !== scopeHash` (`:550`, and validations at `:336`), throwing an opaque NotFound.
  Multi-user HTTP with no stable actor **refuses to persist** (`workspaceScope.ts:87`) — that refusal
  *is* the isolation guarantee.
- **Why dangerous:** a mis-derived scope silently reads/writes another tenant's workspace. No crash,
  no denial.
- **Diff red flag:** any scope / `server` / `siteId` / `userLuid` read from **tool args** instead of
  `extra`; a store method losing its `scope` parameter; the `scopeHash` guard removed/weakened; a raw
  PAT/token used as `actorId`; the "refuse to persist" `Err` branch replaced with a shared/default
  actor; `hashScope` inputs or `\0` separators changed.

### 4.4 Advisory-cannot-gate-receipt
- **What:** in `validateWorkbookPackage.ts:175-185`, only `hardWarnings` (`referenceWarnings` from
  `assetReferenceCheck` + `sizeWarnings` from `checkUnder64Mb`) and structural `BuildTwbxError` set
  `ok:false` and withhold the `validationId`. `advisoryWarnings` (builder `contentExtensionWarnings` +
  `undeclaredOriginsCheck`, pushed at `:163-168`) ride along in `warnings` and **never** flip `ok`.
- **Why dangerous both ways:** if an advisory check *starts* blocking, its false positives fail real
  publishes; if a genuine "app will 404 / won't upload" check lands in advisory, broken apps get green
  receipts.
- **Diff red flag:** `undeclaredOriginsCheck` output routed to `hardWarnings`; a new
  best-effort/heuristic check added to `hardWarnings`; a real structural check added to
  `advisoryWarnings`.

### 4.5 REPLACE-not-append (`allowedOrigins`)
- **What:** the `allowedOrigins` param **replaces the entire** allow-list (`manifestOrigins.ts:35-38`).
  Tri-state (`:24`, `z.string().trim().max(2000).optional()`): omitted ⇒ unchanged; empty/whitespace
  ⇒ clear; non-empty ⇒ set.
- **Why dangerous:** a later call that passes only a *new* origin silently drops previously-declared
  ones; their fetches then fail at runtime under the published CSP. No error at declare time.
- **Diff red flag:** description/semantics drifting toward "append"; collapsing "omitted" and "empty"
  (would clear on every no-arg write, or make clearing impossible); the caller gate
  `args.allowedOrigins !== undefined` (`upsertDataAppFiles.ts:116`, `patchDataAppFile.ts:273`) changed.

### 4.6 Round-trip recovery
- **What:** `edit → republish` rebuilds bytes from the *reconstructed* workspace.
  `reconstructWorkspaceFromTwbx` must recover everything shippable: content bytes, datasource
  bindings, and `allowedOrigins` (recovered from the package manifest, `:101-103`, then rebuilt via
  `buildDataAppManifest`, `:151-161`).
- **Why dangerous:** anything reconstruct fails to recover is **silently dropped** on the next publish
  — e.g. a reopened app republishes with its CSP allow-list wiped.
- **Diff red flag:** a PR adds a manifest/package field but doesn't teach reconstruct to recover it;
  a manifest schema-version bump (`DATA_APP_MANIFEST_SCHEMA_VERSION`, now `2`) without matching
  reconstruction handling.

### 4.7 Store-layer import constraint
- **What:** `src/dataApps/` (the provider boundary) must **never** import from
  `src/tools/web/dataApps/`. Dependency flows tools → core, never back. Core files import only sibling
  `src/dataApps/` modules, shared `../errors/`, third-party libs (`zod`, `ts-results-es`), and Node
  builtins — never `../tools/…`.
- **Why dangerous:** if core imported tool code, the store could no longer be swapped for a hosted
  provider, and manifest-shaping logic would leak into the security-critical layer.
- **Diff red flag:** any `import … from '../tools/…'` inside a `src/dataApps/*.ts` file
  (`rg "from '\.\..*tools" src/dataApps/`). Watch for manifest-schema/template imports sneaking into
  core.

### 4.8 Descriptions-are-prompts
- **What:** editing a tool `description` or a `.describe(...)` string changes **model behavior** —
  which tool it picks, what args it passes, workflow ordering.
- **Why dangerous:** a subtle wording change can break the `scaffold → validate → publish` ordering,
  or the "pass appId not a path" invariant, with zero test signal.
- **Diff red flag:** any prose edit to a tool description or schema field description. Review it as
  you'd review a prompt: is the guidance still accurate? Are workflow steps and the REPLACE-not-append
  semantics (§4.5) still stated?

### 4.9 Zod-schema-is-the-API
- **What:** `paramsSchema` (a `ZodRawShape`) *is* the tool's contract with the model.
  `min`/`max`/`.optional()`/`.trim()` define exactly what JSON the model may send.
- **Why dangerous:** loosening a constraint widens what the model sends and can bypass validation the
  callback relies on; tightening can break calls the model was trained to make. Load-bearing examples:
  `allowedOrigins` `.max(2000)`, `datasources` `.min(1).max(8)`.
- **Diff red flag:** raising a `max`, making a field `.optional()`, removing `.trim()`/`.min(1)` —
  check every schema delta against downstream code assumptions.

---

## 5. MCP-specific things non-experts miss

1. **Descriptions & param-descriptions are model-facing prompts** (see §4.8). Not comments.
2. **The Zod schema is the model's contract** (see §4.9). Registered as `inputSchema`
   (`server.web.ts:173`).
3. **Result / error shape:** tools return `CallToolResult = { isError, content: [{type:'text', text}] }`.
   Success default is `JSON.stringify(result)` (`tool.ts:196`) — the model reads that text, so changing
   result JSON shape silently changes what the model sees next, and should be reflected in the
   description's `**Result:**` prose.
4. **Error conventions are deliberate and unusual:** business logic returns `Result<T, McpToolError>`
   (ts-results-es), *not* throws, routed through `logAndExecute`. Two subtle behaviors: a
   `ZodiosValidationError` (our schema too strict for a real API response) is deliberately returned as
   **`isError:false`** with the raw payload + warning (`tool.ts:263-283`) — don't "fix" it into an
   error. Genuine errors are `isError:true` with `requestId`. Telemetry keys off `toolResult.isError`
   (`:243-246`). New tools should use `McpToolError` subclasses + `.toErr()`, not raw throws.
5. **Registration is multi-file and easy to half-do:** a tool can compile yet be invisible (missing
   from `webToolFactories`), un-gateable (missing from `webToolGroups`), or crash at startup (missing
   `toolScopeMap` entry). See §3 row 1.
6. **Identity comes only from `extra` (`TableauWebRequestHandlerExtra`)** — the callback's second arg.
   It's the only trustworthy source of caller identity/scope. A tool must never take `userId`/`siteId`
   from `args`.

---

## 6. Security review focus

**The model (one paragraph):** a published data app runs in a viz-extension sandbox under a strict
CSP. It can only reach origins in the package `manifest.json` `allowedOrigins` key; the **monolith**
(PR #61836, *out of this repo*) folds those into the served-content CSP `default-src`. An undeclared
origin is blocked and — since the sandbox has no console — fails silently. This repo does only two
things: **Part A — declaration plumbing** (carry declared origins tool param → `dataapp.json` →
package `manifest.json`) and **Part B — an advisory detector** (`undeclaredOriginsCheck`) that warns
when packaged code fetches an undeclared origin. **The enforcer is the monolith; this repo only
declares and warns. Detection ≠ enforcement.**

**The red flags:**
- **Never self-allowlist:** the detector must **only warn**, never auto-add a detected origin to
  `allowedOrigins` (`undeclaredOriginsCheck.ts:19-21`). A hallucinated/injected URL must never
  allowlist itself. Red flag: any code path where scanned file content feeds back into the manifest
  allow-list.
- **The exact key name `allowedOrigins` in `manifest.json` is a hard contract with the monolith.**
  The spec explicitly rejected renaming it to `requestedOrigins` for the package key (§1, §8). A
  rename there silently breaks the CSP grant; `reconstruct` reads back this exact key.
- **CSP-style origin matching is a subtle bug surface** (`undeclaredOriginsCheck.ts`) — too loose =
  missed warnings (author ships a silently-broken app), too tight = noise:
  - Bare `*` matches everything, short-circuits before regex (`:111`).
  - Scheme upgrade (`:81-88`): `http` covers `https`, `ws` covers `wss` — **not symmetric** (`https`
    does not cover `http`). A diff making it symmetric is wrong.
  - `*.example.com` matches proper subdomains only, **not** the apex (the `originHost.length >
    suffix.length` check, `:98`). Dropping it silently widens matching.
  - Port normalization (`:132-139`): a source with **no** port matches **only** the scheme's default
    port — a "simplification" treating no-port as "any port" is a real security miss.
  - A non-parsing source matches nothing (safe default, `:117`). A diff making a bad source match
    everything is dangerous.
  - Ignored namespace hosts `www.w3.org` / `www.opengis.net` (`:38`) — SVG/XML namespace strings, not
    fetch targets. Don't "clean up" the ignore-list without understanding it fires on every chart.
- **Don't conflate the two CSPs:** `cspAllowedDomains` / `CSP_ALLOWED_DOMAINS` (`config.ts:80`) is the
  CSP for the MCP server's *own* served content — distinct from the data-app sandbox CSP the monolith
  enforces.
- **Out-of-scope = red flag, with one carve-out:** the allowed-origins spec states "No REST API,
  transport, or auth changes." A data-apps PR touching `config.ts` auth blocks, OAuth files,
  `enablePassthroughAuth`, or `X-Tableau-Auth` handling is out of scope for *that* feature. **Carve-out:**
  `edit-data-app` legitimately calls REST — it downloads the published workbook
  (`workbooks:download`, `includeExtract:false`, `editDataApp.ts:118`) and routes the bytes through
  `reconstructWorkspaceFromTwbx`. Don't flag that as out-of-scope; do review the download + reconstruct
  path. Data-app *authoring* tools consume only the already-validated `extra.tableauAuthInfo`.
- **Log masking:** no new logging of manifest content, headers, credentials, or tokens. `secretMask.ts`
  redacts known secret keys; a diff logging a raw object can bypass it.

---

## 7. Reviewing tests

**Test taxonomy:**

| Kind | Where | Guarantees |
|---|---|---|
| **Unit** | `*.test.ts` colocated (e.g. `manifestOrigins.test.ts`) | one module in isolation; tools run against the **fake** store (`workspaceStore.mock.ts`), not the FS |
| **Contract / drift-guard** | `packageValidation.contract.test.ts` | pins the contract between the **real** builder and the validator's checks; breaks deliberately when a builder constant changes |
| **Integration (in-memory)** | `*.integration.test.ts` (`liveDataAppFlow.integration.test.ts`) | full flow through real tool callbacks + real `FileSystemWorkspaceStore` in a temp dir; mocks **only** `useRestApi` |
| **Golden / determinism** | inside builder unit tests (`buildTwbx.test.ts:218`, round-trip in `reconstructWorkspaceFromTwbx.test.ts`) | identical input → byte-identical output; stable digests |

`liveDataAppFlow.integration.test.ts:1-19` is the best single overview. All run under `npm test`.
Run one file with `npx vitest run src/path/to/file.test.ts`. E2E (real render) is out of scope here.

**Tests that MUST accompany common change types:**
- **New tool:** asserts `tool.name` + `requiredApiScopes`; schema-boundary rejection *before* store
  access; happy path vs the fake store; `isError` mapping. Registered in `tools.ts` + `toolName.ts`.
  Appears in the integration flow if it participates in scaffold/validate/publish.
- **New validation check:** pure-function tests for pass/flag/dedupe/deterministic-sort; a
  **never-throws-on-garbage** test; scans right file types, skips binaries. Wired into the contract
  test's `validate()` composition. **Hard-vs-advisory policy assertion** (does it flip `ok`?). An
  integration assertion that a real workspace triggers it.
- **Manifest byte change:** a **byte-for-byte** assertion (`manifestOrigins.test.ts:71-78`); confirm
  the manifest is not packaged (`packageValidation.contract.test.ts:85-90`); expect the contract
  drift-guard to break — and that break must be a **deliberate** update, not a silent re-record.
- **`allowedOrigins` semantics:** spans two modules — writer (`manifestOrigins.ts`) and detector
  (`undeclaredOriginsCheck.ts`). Cover param trim/clear/length-cap; write goes through `writeManifest`
  not `upsertFiles`; and the CSP-matching edge cases (wildcard-vs-apex, default-port normalization,
  scheme upgrade, bare `*`, blank==none).

**Test smells:**
1. Missing byte-stability assertion on a builder/manifest change.
2. Missing never-throws test for a detector (it runs on arbitrary agent-authored garbage).
3. Missing round-trip test when a builder has an inverse.
4. Receipt-integrity gap: no test that published bytes == validated bytes even after source mutation.
5. Advisory-vs-hard confusion: a new check with no policy assertion.
6. Contract snapshot silently re-recorded to "fix" a break rather than justify it.
7. Scope change without a cross-actor cannot-read test.
8. **Fake store drifting from real store:** the fake *manually mirrors* real invariants (protected
   paths, digest formula, scope keying). A PR that changes `FileSystemWorkspaceStore` semantics but not
   the fake — and adds no integration coverage — produces green tests over stale behavior. Cross-check
   `fileSystemWorkspaceStore.test.ts`.
9. **Asserting the mock, not behavior:** `expect(writeManifest).toHaveBeenCalled()` proves *routing*,
   not *result* — pair it with a byte assertion.
10. **Over-mocking "integration":** if an integration test mocks the store or builder, it's quietly
    demoted to a unit test.

---

## 8. The review checklist

Run top-to-bottom. Each item is file-anchored.

**Correctness**
- [ ] New tool registered in **all four**: `webToolFactories` (`tools.ts`), `webToolNames`
  (`toolName.ts`), correct `webToolGroups`, `toolScopeMap` (`scopes.ts`).
- [ ] Callback returns `Result<T, McpToolError>` via `logAndExecute`; uses `McpToolError` subclasses,
  not raw throws.
- [ ] Result JSON shape changes are reflected in the tool description's `**Result:**` prose.
- [ ] `checksPerformed` (`validateWorkbookPackage.ts:34`) still accurately enumerates what runs.

**Invariants (§4)**
- [ ] Byte-stability: new manifest/package fields emitted **last** and **only when non-empty**; no
  indentation/newline change; no time-based or unsorted field.
- [ ] `allowProtected:true` appears only in `create` and `writeManifest`; `writeManifest` writes the
  fixed path only; `dataapp.json` still in `PROTECTED_WORKSPACE_FILES`; tool-layer
  `isProtectedManifestPath` guard intact.
- [ ] Scope resolved from `extra` (`resolveScopeFromExtra`), never from args; `scope` param present on
  every store method; `scopeHash` guard intact; refuse-to-persist branch intact.
- [ ] `allowedOrigins` REPLACE semantics + tri-state (omitted/empty/non-empty) preserved; caller gate
  `!== undefined` intact.
- [ ] `reconstructWorkspaceFromTwbx` recovers every shippable field (bindings, content bytes,
  `allowedOrigins`); schema-version bump matched by reconstruction.
- [ ] No `import from '../tools/…'` in `src/dataApps/*.ts`.
- [ ] Every `appId`→path build routes through `parseOpaqueId`; `appIdSchema`/`OPAQUE_ID_PATTERN` not
  loosened.

**Security (§6)**
- [ ] Detector only warns — never auto-adds to `allowedOrigins`; no scanned content feeds back into
  the allow-list.
- [ ] Package `manifest.json` key stays literally `allowedOrigins`.
- [ ] CSP matching unchanged unless intended: scheme-upgrade asymmetric, `*.` excludes apex, no-port
  matches only default port, bare `*` short-circuits, non-parsing source matches nothing.
- [ ] No auth/transport/REST changes (`config.ts` auth, OAuth, passthrough, `X-Tableau-Auth`) — except
  `edit-data-app`'s legitimate `workbooks:download`; no new logging of manifest/headers/credentials.
- [ ] `advisoryWarnings` vs `hardWarnings` bucket correct for any new check.

**Tests (§7)**
- [ ] Change type has its mandatory tests (byte-for-byte / never-throws / round-trip / policy /
  cross-actor).
- [ ] Fake store updated if real store semantics changed; integration coverage added for
  store-semantics changes.
- [ ] Contract drift-guard break is justified, not silently re-recorded.
- [ ] No spy-only assertions without a state/byte check; integration tests mock only `useRestApi`.

**MCP-hygiene (§5)**
- [ ] Description/`.describe()` edits reviewed as prompts (workflow order, appId-not-path, REPLACE
  semantics still stated).
- [ ] Zod schema deltas (`max`/`optional`/`trim`/`min`) checked against downstream assumptions.
- [ ] `ZodiosValidationError` → `isError:false` behavior not "fixed" into an error.

---

## 9. Worked example — the `allowedOrigins` PR through the checklist

The feature adds two capabilities: **Part A** carries author-declared external origins from tool
param → `dataapp.json` → package `manifest.json`; **Part B** adds a validate-time advisory detector.
Walking the checklist:

- **Registration:** no new tool — `allowedOrigins` is a new optional param on `scaffold`, `upsert`,
  `patch`. So the four-file registration check is N/A, but the **Zod schema** check fires:
  `allowedOriginsParam = z.string().trim().max(2000).optional()` (`manifestOrigins.ts:24`). Verify the
  `.max(2000)` cap and tri-state are load-bearing. ✔
- **Byte-stability (§4.1):** `buildDataAppManifest` emits `allowedOrigins` **last, only when
  trimmed-non-empty** (`templates.ts:89-92`); `renderManifest` does the same for the package manifest
  (`buildTwbx.ts:192-195`). Confirm a no-origins app produces byte-identical output to the pre-feature
  scaffold, and that `manifestOrigins.test.ts:71-78` has the byte-for-byte assertion. The schema
  version bumped to `2` — check reconstruction handles it. ✔
- **Protected manifest (§4.2):** the new `writeManifest` (`fileSystemWorkspaceStore.ts:214`) is the
  single sanctioned store writer, `allowProtected:true`, fixed path. `updateManifestAllowedOrigins`
  (`manifestOrigins.ts:51-67`) does read-modify-write through it — **not** raw JSON, **not**
  `upsertFiles`. Confirm it passes through *every* existing manifest field (`datasources`,
  `packageId`) so the rebuild doesn't corrupt the manifest, and that the tool-layer
  `isProtectedManifestPath` guard is untouched. ✔
- **Scope (§4.3):** param carries origin *values*, not scope. Confirm scope still comes from
  `resolveScopeFromExtra(extra)` and the param can't influence it. ✔
- **REPLACE-not-append (§4.5):** value replaces the whole list (`manifestOrigins.ts:35`). Confirm the
  param **description** documents this (a §4.8 prompt concern) and the caller gates on `!== undefined`
  (`upsertDataAppFiles.ts:116`, `patchDataAppFile.ts:273`). ✔
- **Round-trip (§4.6):** `reconstructWorkspaceFromTwbx` recovers `allowedOrigins` from the package
  manifest (`:101-103`) and rebuilds `dataapp.json`. Without this, edit→republish wipes the allow-list
  silently. Confirm a round-trip test exists. ✔
- **Corrupted-manifest degradation:** `readAllowedOrigins` guards `typeof !== 'string' ⇒ undefined`
  (`buildWorkspaceTwbx.ts:85`) — a hand-edited manifest degrades to "omit," never a `TypeError`. ✔
- **Advisory-cannot-gate (§4.4) + Security (§6):** `undeclaredOriginsCheck` (`undeclaredOriginsCheck.ts:149`)
  must land only in `advisoryWarnings` (`validateWorkbookPackage.ts:163-168`), never flip `ok:false`. It
  must **not** auto-add detected origins (self-allowlist). Verify the CSP matching semantics
  (scheme-upgrade asymmetry, `*.` vs apex, no-port=default-port). Confirm the package key stays
  `allowedOrigins` (not the considered-and-rejected `requestedOrigins`). ✔
- **Tests (§7):** spec §7 lists detector matching tests, byte-stability, REPLACE, round-trip, a
  never-throws test, and two `validateWorkbookPackage.test.ts` integration tests (advisory-emitted at
  `:232` + silent-when-declared at `:248`). Confirm the contract drift-guard break (from the manifest
  byte change rippling into digests) is a deliberate update. ✔
- **Out-of-scope:** spec §5 states no REST/auth/transport changes — confirm the diff touches none of
  `config.ts` auth, OAuth, or passthrough. ✔

Result: a clean PR touches exactly the Part A plumbing files + the Part B detector + their tests
(spec §6), preserves all silent invariants, and keeps the detector purely advisory.

---

## 10. Glossary

- **MCP (Model Context Protocol):** protocol by which an LLM discovers and calls server-side tools.
- **Tool:** a named, Zod-validated function the model invokes with a JSON args object.
- **WebTool:** the base class (`src/tools/web/tool.ts`) for HTTP-server tools; carries name,
  description, schema, scopes, callback.
- **twbx:** Tableau packaged workbook — a deterministic zip: `<name>.twb` +
  `Packages/<id>/{manifest.json, extensions/toolbar.trex, content/…}`.
- **Workspace:** a per-actor-scoped server-side bag of source files for one data app.
- **Scope:** the trust/isolation boundary `{server, siteId, actorId}`; derived only from
  server-verified signals; storage partitioned by its SHA-256 hash.
- **Opaque ID:** 128-bit random hex (`/^[0-9a-f]{32}$/`); carries no path characters and reveals
  nothing about the caller. `appId` and `validationId` are opaque IDs.
- **Manifest — `dataapp.json`:** the tool-managed *workspace* manifest (source of truth in the
  workspace); protected; not shipped as content.
- **Manifest — package `manifest.json`:** the shipped `Packages/<id>/manifest.json`
  (`{id, version, name, author, allowedOrigins?}`); a hard contract with the monolith; `id` must equal
  the folder name.
- **CSP (Content-Security-Policy):** browser policy restricting which origins content may reach; the
  data-app sandbox enforces a strict one.
- **Origin:** scheme + host + port (e.g. `https://api.example.com:8443`).
- **allowedOrigins:** the space-separated set of external origins a data app declares it will fetch;
  the monolith folds them into the sandbox CSP `default-src`. Declaration, not enforcement.
- **LUID:** Tableau's opaque locally-unique identifier for users/sites; part of the resolved identity
  in `tableauAuthInfo`.
- **Receipt / validationId:** the opaque, scoped, expiring handle returned by validate; points at
  immutable built bytes so publish ships exactly what was validated.
- **Advisory vs hard warning:** advisory rides in `warnings` and never blocks; hard
  (`referenceWarnings` + `sizeWarnings`) sets `ok:false` and withholds the receipt.
- **Byte-stability:** identical input → byte-identical output; the backbone of the receipt→publish
  digest match and golden tests.
- **PAT / passthrough:** Personal Access Token auth; passthrough = the `X-Tableau-Auth` header path.
  Never part of scope; never logged. Out of scope for data-apps PRs.
