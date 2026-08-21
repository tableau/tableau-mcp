# UploadUrlProvider — tableau-mcp portion

Cross-repo change with tabhf-mcp-svc (`/Users/j.song/Desktop/mcp/tabhf-mcp-svc`). This file
covers only the tableau-mcp side. Full cross-repo plan (context + tabhf-mcp-svc side +
sequencing): `/Users/j.song/.claude/plans/concurrent-pondering-pudding.md` (orchestrator
workspace, not checked into this repo).

**Update (2026-08-20): no change on this side.** tabhf-mcp-svc's custom provider was redesigned
after this PR opened — its `getUploadUrl` now mints via a real S3 multipart `UploadId` instead of
a self-issued HMAC token, and its write route recovers `key`/`bucket` via
`ListMultipartUploadsCommand` instead of trusting a signed payload (see tabhf-mcp-svc's
`docs/plans/upload-url-provider.md` and `/Users/j.song/.claude/plans/cozy-purring-adleman.md`).
The `UploadUrlProvider` interface below (`getUploadUrl` params/return shape) is unaffected — the
`uploadUrl` string is opaque to tableau-mcp either way, so this redesign is 100% internal to the
tabhf-mcp-svc implementation and requires no changes here.

## Context

`request-workbook-upload` currently mints a raw S3 presigned PUT URL and hands it straight to
the MCP client. Some deployments (tabhf-mcp-svc) want to swap that for a stable, first-party
URL (`https://mcp.tableau.com/upload/<workbookUploadId>`) that proxies the write through their
own service into the same S3 key `validate-upload-and-publish-workbook` reads back from — with
zero changes needed on the read-back side. tableau-mcp itself must keep today's exact behavior
by default; only a deployment that opts in via env var changes.

The mechanism is a new pluggable provider of the exact same shape as the existing
`FeatureGateProvider`/`TelemetryProvider` pattern: env-var-selected `server` (default, today's
behavior) vs `custom` (deployment-supplied module, `require()`-loaded, duck-type validated).

## Changes

New `src/uploadUrl/` directory, mirroring `src/features/` file-for-file:

1. **`src/uploadUrl/uploadUrlProvider.ts`** — public, dependency-free interface (mirrors
   `src/features/featureGateProvider.ts`), exposed as a package subpath:
   ```ts
   export interface UploadUrlProvider {
     getUploadUrl(params: {
       workbookUploadId: string;
       key: string;
       bucket: string;
       region: string;
       contentType: string;
       presignTtlSeconds: number;
     }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string> }>;
   }
   ```
   `key`/`bucket`/`region` describe where the default provider stores the object; a custom
   provider may route the upload elsewhere as long as bytes end up at that same key.

2. **`src/uploadUrl/types.ts`** — zod schemas mirroring `src/features/types.ts`:
   `uploadUrlProviderSchema = z.enum(['server','custom'])`, `serverUploadUrlConfigSchema`,
   `customUploadUrlConfigSchema` (reuse the `providerConfigSchema` shape — `{module: string}`
   passthrough), discriminated union `uploadUrlConfigSchema`.

3. **`src/uploadUrl/serverUploadUrlProvider.ts`** — default implementation, thin wrapper
   preserving today's exact behavior via the existing `createPresignedPutUrlToS3` in
   `src/tools/web/s3Client.ts:158-182`.

4. **`src/uploadUrl/init.ts`** — loader/singleton mirroring `src/features/init.ts` line-for-line:
   `validateUploadUrlProvider` (duck-type check for `getUploadUrl`), `getUploadUrlProvider()`,
   `initializeUploadUrlProvider(config)` (`'server'` → `new ServerUploadUrlProvider()`,
   `'custom'` → `loadCustomProvider(config)`, falls back to server on error),
   `loadCustomProvider(config)` (same resolution/`require()` logic as
   `features/init.ts:117-177`), `resetUploadUrlProvider()` for tests.

5. **`src/config.ts`** — add `uploadUrl` config mirroring the existing `featureGate` wiring:
   env vars `UPLOAD_URL_PROVIDER` (default `'server'`) and `UPLOAD_URL_PROVIDER_CONFIG` (JSON),
   parsed via `uploadUrlConfigSchema`. Document both in `env.example.list`.

6. **`src/index.ts`** — call `initializeUploadUrlProvider()` alongside the existing
   `initializeFeatureGate()` call (line 26).

7. **`package.json`** — add a third `exports` subpath, matching the existing two:
   ```json
   "./uploadUrl/uploadUrlProvider": { "types": "./build/uploadUrl/uploadUrlProvider.d.ts" }
   ```
   and add `"src/uploadUrl/uploadUrlProvider.ts"` to `tsconfig.providers.json`'s `include` array.

8. **`src/tools/web/workbooks/stagedWorkbookUpload.ts`** — the call-site change.
   `requestStagedWorkbookUpload` (lines 46-52) currently calls `createPresignedPutUrlToS3`
   directly; change it to call `getUploadUrlProvider().getUploadUrl({...})` with the same params
   (key from `buildWorkbookUploadS3Key`, bucket/region/presignTtlSeconds from `config`,
   contentType from `WORKBOOK_UPLOAD_CONTENT_TYPE`), and use the returned `requiredHeaders`
   instead of the hardcoded object. `resolveStagedWorkbookUpload` and
   `requestWorkbookUpload.ts` need **no changes**.

9. Tests: update `stagedWorkbookUpload.test.ts` to mock `getUploadUrlProvider()` instead of
   `createPresignedPutUrlToS3` directly; add `src/uploadUrl/init.test.ts` mirroring
   `src/features/init.test.ts` (provider selection, custom-loader resolution, duck-type
   validation, fallback-to-server-on-error).

## Sequencing note

tabhf-mcp-svc's implementation depends on this `UploadUrlProvider` type existing as a real
package export, so this PR should land/publish before tabhf-mcp-svc finalizes against it.

## Verification

```
npx vitest run src/uploadUrl/init.test.ts src/tools/web/workbooks/stagedWorkbookUpload.test.ts
npx vitest run   # full suite
npm run lint
npm run build    # confirms build/uploadUrl/uploadUrlProvider.d.ts is emitted and exports resolve
```

## PR workflow

Use this repo's `create-pr-from-commits` skill (`.claude/skills/create-pr-from-commits/`) — do
not hand-roll git. Do not commit/PR until the orchestrator's dual-reviewer + synthesis gate has
produced `VERDICT: PASS`.
