# Remove S3 from tableau-mcp, replace with pluggable BlobStorageProvider

## Context

tableau-mcp currently has S3 baked in directly (`@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner`, `src/tools/web/s3Client.ts` and its two thin
wrappers) to offload view images, view CSV data, and workbook downloads/uploads
out of MCP tool responses and into presigned-URL-backed storage. This couples
the open-source repo to a specific cloud vendor and forces on-prem/self-hosted
customers into either running with offload disabled or forking the repo.

The codebase already has an established "bring your own infra" pattern for
exactly this kind of concern: `TelemetryProvider` and `FeatureGateProvider` are
dependency-free interfaces, published as `.d.ts`-only npm package subpath
exports, selected via env var (`<DOMAIN>_PROVIDER=noop|custom` +
`<DOMAIN>_PROVIDER_CONFIG='{"module": "..."}'`), loaded via `require()` with
duck-type validation, and falling back to a safe default on any error. This
plan extends that exact pattern to storage: a new `BlobStorageProvider`
interface ships in tableau-mcp with a no-op default (matching
`NoOpTelemetryProvider`), all S3-specific code is deleted from tableau-mcp, and
the concrete S3-backed implementation is (re)built in `tabhf-mcp-svc` as a
custom provider — mirroring how MonCloud/DynamoDB implementations already live
there for telemetry and feature gates.

This also supersedes the never-implemented `.claude/plans/upload-url-provider.md`
plan, which only covered the narrower staged-upload-PUT slice; this plan
covers the full S3 surface (offload upload+read-URL, staged-upload PUT,
staged-upload download) with one interface.

## Interface design

New module `src/blobStorage/` in tableau-mcp, mirroring `src/features/` file-for-file:

- `blobStorageProvider.ts` — the dependency-free interface (published as a
  `.d.ts`-only package export, added to `tsconfig.providers.json`):

  ```ts
  export interface BlobStorageProvider {
    upload(params: {
      key: string;
      data: Buffer;
      contentType: string;
    }): Promise<{ url: string; expiresAt?: string }>;

    getPresignedUploadUrl(params: {
      key: string;
      contentType: string;
    }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string>; expiresAt?: string }>;

    download(params: {
      key: string;
      maxBytes: number;
    }): Promise<Buffer | undefined>; // undefined = not found
  }
  ```

  `key` is a logical, unprefixed identifier built by tableau-mcp (e.g.
  `images/<resourceId>.<format>`, `workbook-uploads/<uploadId>.<ext>`) — any
  bucket/region/prefix/TTL concerns are entirely the custom provider's own
  business now, passed via its own `providerConfig`, not part of this
  interface. `expiresAt` is optional data the provider hands back (since
  tableau-mcp no longer owns TTL) for tools that currently surface expiry to
  the MCP client (e.g. `request-workbook-upload`'s response).

- `noopBlobStorageProvider.ts` — `NoopBlobStorageProvider implements BlobStorageProvider`,
  all three methods throw `BlobStorageNotConfiguredError` (new error type
  alongside the other errors in `src/errors/`).

- `types.ts` — zod schema `blobStorageProviderConfigSchema` (discriminated
  union `{provider: 'noop'} | {provider: 'custom', providerConfig: {module: string, [k: string]: unknown}}`).

- `init.ts` — mirrors `src/features/init.ts` line-for-line: module-singleton,
  `initializeBlobStorageProvider()` (switches on `BLOB_STORAGE_PROVIDER` env
  var, `require()`-loads + duck-type-validates a custom module, falls back to
  `NoopBlobStorageProvider` on any error with a logged warning),
  `getBlobStorageProvider()` (lazy default), `resetBlobStorageProvider()` (for
  tests). **Additionally exposes `isBlobStorageEnabled(): boolean`** — true
  only if a custom provider was selected *and* successfully loaded, false for
  `noop` or fallback-after-error. This is plain init-module bookkeeping, not
  part of the `BlobStorageProvider` interface itself — custom implementations
  don't need to implement any "am I enabled" method.

- Env vars (new): `BLOB_STORAGE_PROVIDER` (`noop` default | `custom`),
  `BLOB_STORAGE_PROVIDER_CONFIG` (JSON, e.g. `{"module": "./my-provider.js"}`).
  Document in `env.example.list` and `docs/docs/configuration/mcp-config/env-vars.md`
  (same `:::tip[Custom Provider]` style callout already used for telemetry/feature-gate).

- `initializeBlobStorageProvider()` called from `src/index.ts` alongside
  `initializeFeatureGate()`/telemetry init.

## Full removal from tableau-mcp

Delete outright:
- `src/tools/web/s3Client.ts`, `uploadImageToS3.ts`, `uploadDataToS3.ts` and
  their `.test.ts` files.
- `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` from `package.json`
  (+ regenerate `package-lock.json`).
- `Config.bucketS3` and its env vars `MCP_S3_BUCKET`, `AWS_DEFAULT_REGION`,
  `MCP_IMAGE_PREFIX`, `FILE_TTL` from `src/config.ts` and `env.example.list`.
- `.claude/plans/upload-url-provider.md` (superseded by this plan).

Update call sites (all currently import from `s3Client.js`/`uploadImageToS3.js`/`uploadDataToS3.js`):
- `src/tools/web/views/imageToolResult.ts` — replace `uploadImageToS3` call
  with `getBlobStorageProvider().upload({key: buildImageKey(...), data, contentType})`;
  existing try/catch-and-fall-back-to-inline logic is unchanged (a
  `BlobStorageNotConfiguredError` throw is just another caught failure).
  Replace the `config.bucketS3.enabled` gate with `isBlobStorageEnabled()`.
- `src/tools/web/views/dataToolResult.ts` — same treatment for CSV.
- `src/tools/web/workbooks/workbookToolResult.ts` — same treatment; keep the
  existing local-temp-path fallback (`kind: 'path'`) as the failure path.
- `src/tools/web/workbooks/stagedWorkbookUpload.ts` — `requestStagedWorkbookUpload`
  calls `getBlobStorageProvider().getPresignedUploadUrl(...)` instead of
  `createPresignedPutUrlToS3`, using the returned `requiredHeaders`/`expiresAt`
  directly instead of hardcoding them. `resolveStagedWorkbookUpload` calls
  `getBlobStorageProvider().download({key, maxBytes: MAX_STAGED_WORKBOOK_BYTES})`
  instead of `downloadObjectFromS3IfExists`, probing `.twb`/`.twbx` key
  variants the same way.
- `src/tools/web/workbooks/requestWorkbookUpload.ts` — replace the eager
  `if (!extra.config.bucketS3.enabled) throw ...` with an eager
  `if (!isBlobStorageEnabled()) throw UnknownError('Blob storage provider must be configured before requesting staged workbook uploads.')` check (same
  upfront-clean-error UX, now provider-agnostic wording).
- `src/tools/web/workbooks/publishWorkbook.ts` — `resolveWorkbookInput` swaps
  its two `config.enabled` checks for `isBlobStorageEnabled()`: keep the
  existing policy of rejecting `workbookFilePath` when blob storage is
  configured, and rejecting `workbookUploadId` when it isn't — same behavior,
  provider-agnostic wording ("staged uploads" instead of "staged S3 uploads").
  `BucketS3Config` type import is dropped; `resolveStagedWorkbookUpload` no
  longer takes a config param (the provider owns its own config internally).

Update tests: rewrite the mocking approach across the ~10 affected test files
(currently `vi.mock('@aws-sdk/client-s3', ...)` etc.) to mock
`getBlobStorageProvider()`/the module-level provider getter instead — same
pattern already used for `getFeatureGate()` mocks elsewhere in the suite. Add
`src/blobStorage/init.test.ts` mirroring `src/features/init.test.ts`.

Update docs: `env-vars.md` (remove the 4 old sections, add
`BLOB_STORAGE_PROVIDER`/`BLOB_STORAGE_PROVIDER_CONFIG`), and the 5 tool docs
(`get-view-image.md`, `get-custom-view-image.md`, `get-view-data.md`,
`get-custom-view-data.md`, `download-workbook.md`) — replace "S3 mode"/"stored
in S3" language with generic "blob storage mode" wording.

## tabhf-mcp-svc: concrete S3 implementation

New `BlobStorageProviderImpl implements BlobStorageProvider` (type-only import
from `@tableau/mcp-server/blobStorage/blobStorageProvider`, following the
existing `MonCloudTelemetryProvider`/`FeatureFlagService` pattern of
`export default` + wiring via `BLOB_STORAGE_PROVIDER_CONFIG`'s `module` path).

- `getPresignedUploadUrl` — the unmerged `dev/feat/upload-url-provider` branch
  already has this solved for the staged-upload case: `UploadUrlProviderImpl.ts`
  (S3 multipart upload via `CreateMultipartUploadCommand`) +
  `uploadRoute.ts` (`PUT /upload/:uploadId` proxy route that recovers the
  target key via `ListMultipartUploadsCommand`, streams with a byte cap,
  completes via `UploadPartCommand`/`CompleteMultipartUploadCommand`). Retarget
  this from the narrower `UploadUrlProvider` interface to this method on the
  unified `BlobStorageProvider`.
- `upload` and `download` are new, and simple by comparison — port
  tableau-mcp's old `s3Client.ts` logic (`PutObjectCommand` + presigned
  `GetObjectCommand` for `upload`; `GetObjectCommand` + bounded buffer
  conversion + `NoSuchKey`/404 → `undefined` for `download`) directly into
  this repo, since it's the same AWS SDK calls just relocated.
- Bucket/region/key-prefix/presign-TTL become this implementation's own
  config (env vars owned by tabhf-mcp-svc, not tableau-mcp).

## Sequencing

This is a breaking config change for tableau-mcp (removes
`MCP_S3_BUCKET`/`AWS_DEFAULT_REGION`/`MCP_IMAGE_PREFIX`/`FILE_TTL` entirely),
so it needs a major version bump on `@tableau/mcp-server`. tabhf-mcp-svc's
`BlobStorageProviderImpl` must be ready and configured via
`BLOB_STORAGE_PROVIDER=custom` before/at the same time as adopting that major
version in its deployment — same coordination already noted in the superseded
`upload-url-provider.md` plan.

## Verification

- `npx vitest run` (full suite) green in tableau-mcp after the interface,
  init module, and all 6 call-site + test updates land.
- `npm run build` succeeds, including the `tsconfig.providers.json`
  declaration-only build picking up the new `blobStorage/blobStorageProvider.ts`
  export.
- Manual check: with `BLOB_STORAGE_PROVIDER` unset (defaults to `noop`),
  exercise `get-view-image`/`get-view-data`/`download-workbook` and confirm
  inline/local-path fallback still works exactly as today with S3 unconfigured;
  exercise `request-workbook-upload`/`publish-workbook` and confirm the clean
  "must be configured" error.
- In tabhf-mcp-svc: with `BLOB_STORAGE_PROVIDER=custom` pointed at
  `BlobStorageProviderImpl`, exercise the same tool set end-to-end against a
  real S3 bucket (staged upload PUT, publish from `workbookUploadId`, image/CSV
  offload with a real presigned GET URL returned).
