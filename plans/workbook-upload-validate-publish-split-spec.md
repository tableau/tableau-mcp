# Split publish-workbook into upload-workbook + validate-workbook + publish-workbook

## Context

`tableau-mcp`'s workbook authoring flow currently has two MCP tools: `request-workbook-upload`
(stages a file to S3, returns a presigned PUT URL + `workbookUploadId`) and `publish-workbook`
(fuses validate+upload-to-Tableau-session+publish into one call). This second tool does too
much at once — a client that wants to show validation errors before committing to publish, or
retry publish with different overwrite/name/project settings after a successful validation,
can't do so without re-uploading and re-validating.

The ask: split `publish-workbook` into three concerns — uploading to Tableau's file-upload
session, optionally validating, and committing/publishing — so the flow becomes
`request-workbook-upload` (S3 staging) → `upload-workbook` (stage into a Tableau session) →
`validate-workbook` (optional check) → `publish-workbook` (commit), and make the
upload/publish boundary fully **file-agnostic** (twb and twbx treated identically), rather
than branching on file type inside a single fused tool.

**Why upload and validate can't both be file-agnostic and coupled.** Tableau's REST API has
exactly one validation endpoint, `validateWorkbookAndUpload`, and it is documented as one
atomic operation: it validates a TWB *and* stages it into a Tableau upload session as a single
inseparable side effect — there is no "validate without staging" mode, and it only works for
`.twb` (Tableau can't resolve extracts embedded in a `.twbx` from just the inner XML). Meanwhile
`initiateFileUpload`/`appendToFileUpload` (wrapped as `uploadFileInChunks`) are genuinely
file-type-agnostic per their own doc comment ("workbooks, published data sources, and flows all
publish through the same upload session flow") and `publishWorkbook` doesn't care how its
`uploadSessionId` was created.

Given that, we can't have a single upload step that is both file-agnostic AND validates twb
inline — those are two different Tableau-side upload calls. The chosen trade-off: make
`upload-workbook` always use the generic chunked-upload path (true file-agnosticism at the
upload/publish boundary), and make `validate-workbook` an independent, optional, twb-only check
that does its own throwaway Tableau-side upload purely to obtain validation errors/warnings
(discarding the upload session id it gets back — that session is never the one committed).
For `.twbx`, `validate-workbook` is a no-op that always returns valid (Tableau has no way to
check it).

**Important base-branch correction:** the file being split no longer exists under the name
`validateUploadAndPublishWorkbook.ts` — PR #810 (merged to `main`, commit `c5e4bb24`) renamed it
to `src/tools/web/workbooks/publishWorkbook.ts` and added TWBX support (TWBX skips Tableau's
validate endpoint entirely — Tableau can't resolve extracts embedded in a TWBX from just the
inner XML — and goes straight to chunked upload). All of the stale worktrees/branches
(`feat/validate-upload-publish-workbook-tool`, `feat/validate-uploaded-workbook*`) target the
pre-#810 file and must NOT be used as a base. Branch new work from `origin/main`.

## Current state (on `main`, post-#810)

- `src/tools/web/workbooks/publishWorkbook.ts` (326 lines) — tool `publish-workbook`:
  - `paramsSchema` (29-57): `workbookUploadId?`, `workbookFilePath?`, `name`, `projectId`, `overwrite`.
  - `assertMinimumRestApiVersionSupported` (288-294, REST API ≥3.29) — single gate for the whole tool.
  - `assertProjectAllowedByBoundedContext` (296-306).
  - `resolveWorkbookInput`/`resolveLocalWorkbookFile` (236-286) — resolves bytes from S3 staged upload or local file.
  - `getWorkbookFileType` (in `stagedWorkbookUpload.ts`) — determines twb/twbx from filename.
  - Branches: `validateAndUploadTwb` (186-213, calls `restApi.workbooksMethods.validateWorkbookAndUpload`) for `.twb`; `uploadTwbx` (220-234, calls `restApi.publishingMethods.uploadFileInChunks` directly, no validation) for `.twbx`.
  - If invalid → returns `{status:'invalid', errors, warnings}`, no publish.
  - If valid → `restApi.workbooksMethods.publishWorkbook({uploadSessionId, workbookType, name, projectId, overwrite})` → builds default view URL → `{status:'published', data, url, warnings}`.
  - `toValidationFinding`/`sanitizeFindingText` (308-326) — sanitizes/truncates validation findings.
- `src/sdks/tableau/methods/workbooksMethods.ts`: `validateWorkbookAndUpload` (266-298, TWB-only, returns `WorkbookValidationResult` with `uploadId?`, `errors?`, `warnings?`); `publishWorkbook` (213-253, takes `uploadSessionId`+`workbookType`+`name`+`projectId`+`overwrite`, commits a previously-uploaded file — the `uploadSessionId` space is shared between `validateWorkbookAndUpload` and `uploadFileInChunks`).
- `src/tools/web/workbooks/requestWorkbookUpload.ts` — separate tool, unaffected.
- `src/tools/web/tools.ts:72-73` / `src/tools/web/toolName.ts:71` — registry; `authoring` group currently `['request-workbook-upload', 'publish-workbook']`.
- Tests: `publishWorkbook.test.ts` (22 cases covering both validate and publish behavior) and `tests/e2e/workbooks/publishWorkbook.test.ts`.

## Design

Note on naming: `request-workbook-upload` already exists and means "stage bytes to S3" (client
→ S3, no Tableau involvement). The new `upload-workbook` tool means "stage bytes into a Tableau
file-upload session" (MCP server → Tableau, via `uploadFileInChunks`) — a distinct step,
downstream of `request-workbook-upload`. If this naming is confusing in practice, an alternative
is `stage-workbook-to-tableau`, but `upload-workbook` is used below for brevity; flag during
implementation if a clearer name is preferred.

### New tool: `upload-workbook` (file-agnostic)

New file `src/tools/web/workbooks/uploadWorkbook.ts`.

- **Schema**: `workbookUploadId?: string`, `workbookFilePath?: string` (mutually exclusive, exactly one required — reuse `resolveWorkbookInput`).
- **Result**: `{uploadSessionId: string, workbookType: 'twb'|'twbx'}`.
- **Logic**: `assertMinimumRestApiVersionSupported` → `resolveWorkbookInput` → `getWorkbookFileType` (for the returned `workbookType` only — no branching on it) → always `restApi.publishingMethods.uploadFileInChunks({siteId, filename, content})` → return `{uploadSessionId, workbookType}`.
- Same code path for `.twb` and `.twbx` — no `validateAndUploadTwb`/`uploadTwbx` branching. This is the tool that actually determines the `uploadSessionId` used by `publish-workbook`.
- Gated behind `authoring-tools`.

### New tool: `validate-workbook` (optional, twb-only check, independent of upload-workbook)

New file `src/tools/web/workbooks/validateWorkbook.ts`.

- **Schema**: `workbookUploadId?: string`, `workbookFilePath?: string` (same mutually-exclusive resolution as `upload-workbook` — it independently re-resolves the file; it does NOT take an `uploadSessionId` from `upload-workbook`, since it needs raw bytes to call Tableau's validate endpoint itself).
- **Result** (discriminated union): `{status: 'invalid', errors, warnings}` or `{status: 'valid', warnings}`. No `uploadSessionId` in the result — this tool's own Tableau-side upload (a side effect of `validateWorkbookAndUpload`) is intentionally discarded; it is never the session committed by `publish-workbook`.
- **Logic**: `assertMinimumRestApiVersionSupported` → `resolveWorkbookInput` → `getWorkbookFileType` → branch:
  - `.twb` → `restApi.workbooksMethods.validateWorkbookAndUpload(...)` → map errors/warnings via `toValidationFinding` → `{status:'invalid', ...}` if errors, else `{status:'valid', warnings}` (discard `validation.uploadId`).
  - `.twbx` → no Tableau call at all → always `{status:'valid', warnings: []}` (documented in the tool description as a no-op: Tableau cannot validate twbx server-side).
- Gated behind `authoring-tools`.
- Carries over `toValidationFinding`/`sanitizeFindingText` sanitization for the twb branch.
- Calling this tool is optional — a client can go straight from `upload-workbook` to `publish-workbook` and skip validation entirely (e.g. for twbx, or when it doesn't care about pre-publish warnings).

### Slimmed `publish-workbook` (already file-agnostic, unchanged in this respect)

Keep the existing tool name (`publish-workbook`) — no need to rename again after #810.

- **Schema**: `uploadSessionId: string` (required — output of `upload-workbook`), `workbookType: 'twb'|'twbx'` (required, passthrough from `upload-workbook`'s result), `name`, `projectId`, `overwrite`.
- **Logic**: `assertMinimumRestApiVersionSupported` → `assertProjectAllowedByBoundedContext(projectId)` → `restApi.workbooksMethods.publishWorkbook(...)` → build default view URL → `{status: 'published', data, url}`.
- Drops: `resolveWorkbookInput`, `getWorkbookFileType`, `validateAndUploadTwb`, `uploadTwbx`, validation-finding sanitization — all move to `uploadWorkbook.ts`/`validateWorkbook.ts`. `publish-workbook` no longer touches raw file bytes, S3, or Tableau's validate endpoint at all; it only takes an already-resolved `uploadSessionId` + `workbookType`, which was already true of the shared `workbooksMethods.publishWorkbook` REST call today (confirmed: it's called exactly once, identically for twb/twbx, regardless of which staging method produced the session id).

### Registry

- `src/tools/web/tools.ts`: add imports + entries for `getUploadWorkbookTool` and `getValidateWorkbookTool`, keep `getPublishWorkbookTool`.
- `src/tools/web/toolName.ts`: add `'upload-workbook'` and `'validate-workbook'` to `webToolNames`; `authoring` group becomes `['request-workbook-upload', 'upload-workbook', 'validate-workbook', 'publish-workbook']`.

### Tests

- Split `publishWorkbook.test.ts` three ways:
  - Staging/chunked-upload cases (local file resolution, staged-upload resolution, twb/twbx `workbookType` detection, version gate for upload) → new `uploadWorkbook.test.ts`.
  - Validation cases (Tableau validate errors/warnings, missing-uploadId error, twbx no-op-valid, version gate for validate) → new `validateWorkbook.test.ts`.
  - Publish-only cases (overwrite semantics, bounded-context check, publish version gate, published-URL construction, duplicate-name rejection) stay in `publishWorkbook.test.ts`, updated to take `uploadSessionId`+`workbookType` directly as fixture input.
- New e2e tests `tests/e2e/workbooks/uploadWorkbook.test.ts`, `tests/e2e/workbooks/validateWorkbook.test.ts`; trim existing e2e `publishWorkbook.test.ts` to publish-only, chained after an `upload-workbook` call (and optionally `validate-workbook`) in test setup.

### Follow-up to confirm during implementation

Check `src/server/oauth/scopes.ts` for whether `upload-workbook`/`validate-workbook` need their own OAuth scope entries, or can reuse `tableau:workbooks:create` (used by both `validateWorkbookAndUpload` and the chunked-upload endpoints today).

## Rollout

Single PR, branched from `origin/main` (not any of the stale `feat/validate-*` worktrees/branches). All three new/changed tools land together behind the existing `authoring-tools` feature gate — no need for a multi-PR additive rollout since this hasn't shipped externally yet.

## Verification

- `npx vitest run` for the modified/new unit test files (`uploadWorkbook.test.ts`, `validateWorkbook.test.ts`, `publishWorkbook.test.ts`) and full suite before PR.
- `npx tsc` / build.
- E2E tests against a live/mock Tableau server: `tests/e2e/workbooks/uploadWorkbook.test.ts`, `tests/e2e/workbooks/validateWorkbook.test.ts`, `tests/e2e/workbooks/publishWorkbook.test.ts`.
- Manual MCP round-trip: `request-workbook-upload` → `upload-workbook` → (optionally) `validate-workbook` → `publish-workbook`, confirming `workbookType` flows through unmodified and both twb and twbx publish end-to-end via the identical `upload-workbook`/`publish-workbook` code path, with `validate-workbook` behaving as an independent optional check (real check for twb, no-op for twbx).
