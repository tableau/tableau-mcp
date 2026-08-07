# File Upload + Publish Workbook — SDK Layer Design

Date: 2026-08-07
Status: Approved (SDK layer only; no MCP tool in this pass)

## Goal

Add REST-client (SDK) support for three Tableau REST APIs so a future MCP tool
can publish a workbook file to a Tableau site:

1. [Initiate File Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#initiate_file_upload) — `POST /sites/:siteId/fileUploads`
2. [Append to File Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload) — `PUT /sites/:siteId/fileUploads/:uploadSessionId`
3. [Publish Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook) — `POST /sites/:siteId/workbooks`

**Explicitly out of scope for this pass:** any MCP tool (`publish-workbook` etc.),
chunking/looping convenience helpers, HITL/overwrite guarding, project-name
resolution. Those are follow-up work once something actually consumes this SDK
layer.

## Why this isn't a drop-in "add another SDK method"

Every existing SDK method in this repo (`workbooksMethods.ts`,
`datasourcesMethods.ts`, etc.) sends/receives JSON via Zodios, or downloads
binary via `responseType: 'arraybuffer'`. Append-to-file-upload and
publish-workbook (when committing an upload session) both require
**`multipart/mixed`** request bodies — a shape Zodios has no native support
for, and one with no precedent anywhere in this codebase.

## Confirmed wire format

Verified against Tableau's own reference implementation
(`tableau/server-client-python`'s `request_factory.py`), not just the prose
docs (which don't show a literal example for Append):

- **Append to File Upload** — two MIME parts:
  - `request_payload` — empty body, `Content-Type: text/xml`
  - `tableau_file` — the binary chunk, `Content-Type: application/octet-stream`
- **Publish Workbook (via `uploadSessionId`)** — one MIME part:
  - `request_payload` — the `<tsRequest><workbook .../></tsRequest>` XML,
    `Content-Type: text/xml`
  - No file part when committing via `uploadSessionId` (file bytes were
    already sent through Append calls).

Top-level request header must be `Content-Type: multipart/mixed; boundary=...`.

### Why we can't just use `FormData` + axios

Verified empirically against a local test HTTP server: Node's native
`FormData` auto-sets `Content-Type: multipart/form-data`, and **axios
recomputes and overrides any `Content-Type` header you pass** when the body
is a `FormData` instance — so the media type can't be coerced to
`multipart/mixed` that way.

The fix (and what Tableau's own client does under the hood, via urllib3's
encoder) is to hand-build the multipart body as a raw `Buffer` with an
explicit boundary, and set `Content-Type: multipart/mixed; boundary=...`
directly on a `Buffer` body, which axios does NOT override. Confirmed
byte-correct against a local test server.

## New files

### `src/sdks/tableau/multipart.ts`

Shared helper used by both Append and Publish:

```typescript
export function buildMultipartMixedBody(parts: Array<{
  name: string;
  filename?: string;
  contentType: string;
  data: string | Buffer;
}>): { body: Buffer; contentType: string }
```

Builds the raw multipart buffer (boundary generation, per-part
`Content-Disposition`/`Content-Type` headers, CRLFs, trailing boundary) and
returns the `Content-Type` header value to set on the request.

### `src/sdks/tableau/types/fileUpload.ts`

```typescript
export const fileUploadSchema = z.object({
  uploadSessionId: z.string(),
  fileSize: z.coerce.number(),
});
export type FileUpload = z.infer<typeof fileUploadSchema>;
```

### `src/sdks/tableau/apis/fileUploadsApi.ts`

Zodios endpoint definitions (used for typing/documentation; the Append call's
actual request bypasses Zodios's body serialization — see Methods below):

- `initiateFileUpload`: `POST /sites/:siteId/fileUploads` →
  `{ fileUpload: fileUploadSchema }`. No request body.
- `appendToFileUpload`: `PUT /sites/:siteId/fileUploads/:uploadSessionId`
  (query param: optional `sequenceID`) → `{ fileUpload: fileUploadSchema }`.

### `src/sdks/tableau/methods/fileUploadsMethods.ts`

Extends `AuthenticatedMethods<typeof fileUploadsApis>`, following the same
constructor/`baseUrl`/`creds`/`axiosConfig` pattern as `WorkbooksMethods`:

- `initiateFileUpload({ siteId })` — plain Zodios call, JSON in/out. No
  surprises here.
- `appendToFileUpload({ siteId, uploadSessionId, chunk, sequenceId? })` —
  bypasses the Zodios-generated client's request path and calls
  `this._apiClient.axios.put(...)` directly, with the body/headers built via
  `buildMultipartMixedBody`. Same base URL, same `this.authHeader`, same
  interceptors as every other call — only body construction and Content-Type
  differ from the rest of the SDK.

### Extend `src/sdks/tableau/apis/workbooksApi.ts`

Add `publishWorkbookEndpoint`: `POST /sites/:siteId/workbooks` (query params:
`uploadSessionId`, `workbookType`, `overwrite`) → `{ workbook: workbookSchema }`.

### Extend `src/sdks/tableau/methods/workbooksMethods.ts`

Add `publishWorkbook({ siteId, uploadSessionId, workbookType, name, projectId, overwrite? })`:

- Builds `<tsRequest><workbook name="..."><project id="..."/></workbook></tsRequest>`.
- Wraps it via `buildMultipartMixedBody` (single `request_payload` part only —
  no file part, since this design always commits via `uploadSessionId`; see
  "Deferred" below for the single-request/small-file path).
- Calls `this._apiClient.axios.post(...)` directly, same axios-bypass
  rationale as Append.

### Extend `src/sdks/tableau/restApi.ts`

Add a `fileUploadsMethods` getter following the exact `workbooksMethods`
getter pattern (`RestApi.baseUrl`, `this._addInterceptors(...)`, `timeout`/
`signal` passthrough).

## Testing

Unit tests mirror the existing `tasksMethods.test.ts` pattern: mock
`_apiClient` / `_apiClient.axios` and assert on the constructed request (body
bytes, headers, URL, params) — no real network calls. A dedicated
`multipart.test.ts` verifies the raw buffer format (part order, boundary
correctness, CRLFs, trailing boundary, Content-Type header value) against the
exact shape confirmed above.

## Deferred (future work, not this pass)

- **Chunking/looping helper.** `appendToFileUpload` is a thin 1:1 wrapper
  around one REST call; splitting a large file into sequential chunks and
  looping calls is left to a future caller. When built, use a fixed chunk-size
  constant (e.g. `DEFAULT_UPLOAD_CHUNK_SIZE_BYTES = 32MB`) rather than a
  caller-supplied parameter, per YAGNI — no caller exists yet to need
  configurability.
- **Single-request publish path for small files** (embedding the file
  directly in the Publish Workbook call, skipping Initiate/Append entirely).
  This design always uses the 3-call session flow regardless of file size, to
  keep one code path. Revisit only if a real efficiency need shows up.
- **MCP tool** (`publish-workbook`) that consumes this SDK layer, including:
  local file path input, HITL preview/confirm gating tied to `overwrite`,
  project LUID validation, and response shaping for the agent.
