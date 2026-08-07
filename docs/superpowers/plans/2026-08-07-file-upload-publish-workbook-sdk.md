# File Upload + Publish Workbook SDK Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SDK-layer (REST-client) support in `src/sdks/tableau/` for three Tableau REST APIs — Initiate File Upload, Append to File Upload, and Publish Workbook — so a future MCP tool can publish a workbook file to a Tableau site. No MCP tool is built in this pass.

**Architecture:** Two new endpoints (`initiateFileUpload`, `appendToFileUpload`) go on a new `fileUploadsApi.ts` / `fileUploadsMethods.ts` pair, following the exact `WorkbooksMethods`/`workbooksApi.ts` pattern already in the codebase. A third endpoint (`publishWorkbook`) is added onto the existing `workbooksApi.ts` / `workbooksMethods.ts`. Both `appendToFileUpload` and `publishWorkbook` need `multipart/mixed` request bodies, which Zodios cannot produce — those two methods bypass Zodios's typed request path and call `this._apiClient.axios.put(...)` / `.post(...)` directly (a real `AxiosInstance`, exposed via Zodios's `.axios` getter), reusing the same base URL, auth headers, and interceptors as every other call. A new shared helper, `multipart.ts`, hand-builds the raw multipart buffer.

**Tech Stack:** TypeScript, Zodios (`@zodios/core`), axios (accessed via `ZodiosInstance.axios`), Zod, Vitest.

## Global Constraints

- SDK layer only. No MCP tool, no `toolName.ts` change, no `tools.ts` change, no HITL/mutation-guard integration. (Explicit user instruction: "ok lets just start with the apis, no tools".)
- No chunking/looping helper — `appendToFileUpload` is a thin 1:1 wrapper around one REST call.
- No project-name resolution, no single-request small-file publish path — always the 3-call session flow.
- Wire format (confirmed against `tableau/server-client-python`'s `request_factory.py`):
  - **Append to File Upload** — two MIME parts: `request_payload` (empty body, `Content-Type: text/xml`) then `tableau_file` (binary chunk, `Content-Type: application/octet-stream`, `filename="file"`).
  - **Publish Workbook (via `uploadSessionId`)** — one MIME part: `request_payload` (the `<tsRequest>` XML, `Content-Type: text/xml`).
  - Every part's `Content-Disposition` is `form-data; name="<part-name>"` (add `; filename="<filename>"` only when a filename is given).
  - Top-level request header: `Content-Type: multipart/mixed; boundary=<hex>`.
  - Byte layout per part: `--<boundary>\r\n` + headers each as `<Header>: <value>\r\n` (order: `Content-Disposition`, then `Content-Type`) + trailing `\r\n` (blank line) + body bytes + `\r\n`. Final line: `--<boundary>--\r\n`.
- `Content-Type` on a `Buffer` axios request body is NOT overridden by axios (only `FormData` bodies get overridden) — this is why the multipart body must be a raw `Buffer`, not a native `FormData`.
- `axios.put(url, data, config)` / `axios.post(url, data, config)` drop any `undefined`-valued key in `config.params` from the query string (confirmed via `axios`'s `toFormData` helper, which calls `isUndefined(value)` and returns early) — so optional query params can be passed as `undefined` without appearing in the URL.
- Follow existing lint config: this repo enforces `simple-import-sort/imports: 'error'`. Run `npm run lint:fix` after each task to auto-fix import order — do not hand-order imports.

---

### Task 1: `buildMultipartMixedBody` helper

**Files:**
- Create: `src/sdks/tableau/multipart.ts`
- Test: `src/sdks/tableau/multipart.test.ts`

**Interfaces:**
- Produces: `buildMultipartMixedBody(parts: Array<{ name: string; filename?: string; contentType: string; data: string | Buffer }>): { body: Buffer; contentType: string }` — used by Task 3 (`appendToFileUpload`) and Task 4 (`publishWorkbook`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/sdks/tableau/multipart.test.ts
import { describe, expect, it } from 'vitest';

import { buildMultipartMixedBody } from './multipart.js';

describe('buildMultipartMixedBody', () => {
  it('returns a multipart/mixed Content-Type with a boundary', () => {
    const { contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
    ]);

    expect(contentType).toMatch(/^multipart\/mixed; boundary=[0-9a-f]+$/);
  });

  it('uses a different boundary on each call', () => {
    const first = buildMultipartMixedBody([{ name: 'a', contentType: 'text/xml', data: '' }]);
    const second = buildMultipartMixedBody([{ name: 'a', contentType: 'text/xml', data: '' }]);

    expect(first.contentType).not.toEqual(second.contentType);
  });

  it('builds a single-part body with the exact byte layout Tableau expects', () => {
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '<tsRequest/>' },
    ]);
    const boundary = contentType.split('boundary=')[1];

    expect(body.toString('latin1')).toEqual(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="request_payload"\r\n' +
        'Content-Type: text/xml\r\n' +
        '\r\n' +
        '<tsRequest/>\r\n' +
        `--${boundary}--\r\n`,
    );
  });

  it('builds a multi-part body with a filename on the second part, matching Append-to-File-Upload wire format', () => {
    const chunk = Buffer.from([0x01, 0x02, 0x03]);
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
      { name: 'tableau_file', filename: 'file', contentType: 'application/octet-stream', data: chunk },
    ]);
    const boundary = contentType.split('boundary=')[1];

    const expected = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="request_payload"\r\n' +
          'Content-Type: text/xml\r\n' +
          '\r\n' +
          '\r\n',
        'latin1',
      ),
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="tableau_file"; filename="file"\r\n' +
          'Content-Type: application/octet-stream\r\n' +
          '\r\n',
        'latin1',
      ),
      chunk,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
    ]);

    expect(body).toEqual(expected);
  });

  it('preserves binary data unmodified (no UTF-8 mangling)', () => {
    const binaryChunk = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
    const { body } = buildMultipartMixedBody([
      { name: 'tableau_file', filename: 'file', contentType: 'application/octet-stream', data: binaryChunk },
    ]);

    expect(body.includes(binaryChunk)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sdks/tableau/multipart.test.ts`
Expected: FAIL with "Cannot find module './multipart.js'" (or similar resolution error).

- [ ] **Step 3: Write the implementation**

```typescript
// src/sdks/tableau/multipart.ts
import { randomBytes } from 'crypto';

export type MultipartPart = {
  name: string;
  filename?: string;
  contentType: string;
  data: string | Buffer;
};

export function buildMultipartMixedBody(parts: ReadonlyArray<MultipartPart>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = randomBytes(16).toString('hex');

  const chunks: Array<Buffer> = [];
  for (const part of parts) {
    let disposition = `form-data; name="${part.name}"`;
    if (part.filename !== undefined) {
      disposition += `; filename="${part.filename}"`;
    }

    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: ${disposition}\r\n` +
          `Content-Type: ${part.contentType}\r\n` +
          '\r\n',
        'latin1',
      ),
    );
    chunks.push(typeof part.data === 'string' ? Buffer.from(part.data, 'utf-8') : part.data);
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sdks/tableau/multipart.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint and commit**

Run: `npm run lint:fix`

```bash
git add src/sdks/tableau/multipart.ts src/sdks/tableau/multipart.test.ts
git commit -m "feat: add buildMultipartMixedBody helper for Tableau multipart/mixed requests"
```

---

### Task 2: `fileUploadSchema` type

**Files:**
- Create: `src/sdks/tableau/types/fileUpload.ts`

No test file — this mirrors other pure-schema files in `src/sdks/tableau/types/` (e.g. `tags.ts`, `pagination.ts`) that have no dedicated test; the schema is exercised indirectly by Task 3's `fileUploadsMethods.test.ts`.

**Interfaces:**
- Produces: `fileUploadSchema` (Zod schema), `FileUpload` type — used by Task 3 (`fileUploadsApi.ts`, `fileUploadsMethods.ts`).

- [ ] **Step 1: Write the file**

```typescript
// src/sdks/tableau/types/fileUpload.ts
import { z } from 'zod';

export const fileUploadSchema = z.object({
  uploadSessionId: z.string(),
  fileSize: z.coerce.number(),
});

export type FileUpload = z.infer<typeof fileUploadSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this file has no consumers yet, so this just verifies the file itself is syntactically/type valid).

- [ ] **Step 3: Lint and commit**

Run: `npm run lint:fix`

```bash
git add src/sdks/tableau/types/fileUpload.ts
git commit -m "feat: add FileUpload type for Tableau file upload session responses"
```

---

### Task 3: `fileUploadsApi.ts` + `fileUploadsMethods.ts` (Initiate + Append)

**Files:**
- Create: `src/sdks/tableau/apis/fileUploadsApi.ts`
- Create: `src/sdks/tableau/methods/fileUploadsMethods.ts`
- Test: `src/sdks/tableau/methods/fileUploadsMethods.test.ts`

**Interfaces:**
- Consumes: `fileUploadSchema` / `FileUpload` from Task 2 (`src/sdks/tableau/types/fileUpload.js`); `buildMultipartMixedBody` from Task 1 (`src/sdks/tableau/multipart.js`); `AuthenticatedMethods` from `src/sdks/tableau/methods/authenticatedMethods.js` (existing); `RestApiCredentials` from `src/sdks/tableau/restApi.js` (existing); `AxiosRequestConfig` from `src/utils/axios.js` (existing).
- Produces:
  - `fileUploadsApis` (Zodios endpoint array) — consumed by Task 5 (`restApi.ts` getter).
  - `FileUploadsMethods` class with methods `initiateFileUpload({ siteId }): Promise<FileUpload>` and `appendToFileUpload({ siteId, uploadSessionId, chunk, sequenceId }: { siteId: string; uploadSessionId: string; chunk: Buffer; sequenceId?: string }): Promise<FileUpload>` — consumed by Task 5 (`restApi.ts` getter) and by the future (deferred) MCP tool.

- [ ] **Step 1: Write the API definitions**

```typescript
// src/sdks/tableau/apis/fileUploadsApi.ts
import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { fileUploadSchema } from '../types/fileUpload.js';

const initiateFileUploadEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/fileUploads',
  alias: 'initiateFileUpload',
  description:
    'Initiates the upload process for a file to be published as a data source or workbook, or to be attached to a Send-Now request. Returns an upload session ID to reference in follow-up Append to File Upload and Publish Workbook/Data Source calls.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ fileUpload: fileUploadSchema }),
});

/**
 * Not used by Zodios directly (the actual Append call bypasses Zodios's typed
 * request path — see FileUploadsMethods.appendToFileUpload — because Tableau
 * requires a multipart/mixed body Zodios cannot produce). Included here so the
 * endpoint is documented alongside `initiateFileUpload` and so `fileUploadsApis`
 * satisfies `ZodiosEndpointDefinitions` for the `FileUploadsMethods` constructor.
 */
const appendToFileUploadEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/fileUploads/:uploadSessionId',
  alias: 'appendToFileUpload',
  description:
    'Appends a chunk of data to an upload session. Returns the total number of bytes uploaded so far.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'uploadSessionId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'sequenceID',
      type: 'Query',
      schema: z.string().optional(),
    },
  ],
  response: z.object({ fileUpload: fileUploadSchema }),
});

const fileUploadsApi = makeApi([initiateFileUploadEndpoint, appendToFileUploadEndpoint]);

export const fileUploadsApis = [...fileUploadsApi] as const satisfies ZodiosEndpointDefinitions;
```

- [ ] **Step 2: Write the failing tests for `FileUploadsMethods`**

```typescript
// src/sdks/tableau/methods/fileUploadsMethods.test.ts
import { describe, expect, it, vi } from 'vitest';

import FileUploadsMethods from './fileUploadsMethods.js';

describe('FileUploadsMethods', () => {
  describe('initiateFileUpload', () => {
    it('calls the Zodios client and returns the fileUpload payload', async () => {
      const mockApiClient = {
        initiateFileUpload: vi.fn().mockResolvedValue({
          fileUpload: { uploadSessionId: 'session-1', fileSize: 0 },
        }),
      };

      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = mockApiClient;

      const result = await fileUploadsMethods.initiateFileUpload({ siteId: 'site-1' });

      expect(result).toEqual({ uploadSessionId: 'session-1', fileSize: 0 });
      expect(mockApiClient.initiateFileUpload).toHaveBeenCalledWith({
        params: { siteId: 'site-1' },
        headers: { Authorization: 'Bearer test' },
      });
    });
  });

  describe('appendToFileUpload', () => {
    it('PUTs a multipart/mixed body built from the chunk via the raw axios client', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: 5 } },
      });
      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = { axios: { put: mockPut, defaults: { baseURL: 'http://test' } } };

      const chunk = Buffer.from('hello');
      const result = await fileUploadsMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        chunk,
      });

      expect(result).toEqual({ uploadSessionId: 'session-1', fileSize: 5 });
      expect(mockPut).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockPut.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads/session-1');
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('latin1')).toContain('Content-Disposition: form-data; name="request_payload"');
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_file"; filename="file"',
      );
      expect(body.includes(chunk)).toBe(true);
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
      expect(config.params).toEqual({ sequenceID: undefined });
    });

    it('passes sequenceId through as the sequenceID query param', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: 5 } },
      });
      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = { axios: { put: mockPut, defaults: { baseURL: 'http://test' } } };

      await fileUploadsMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        chunk: Buffer.from('hello'),
        sequenceId: '3',
      });

      const config = mockPut.mock.calls[0][2];
      expect(config.params).toEqual({ sequenceID: '3' });
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/sdks/tableau/methods/fileUploadsMethods.test.ts`
Expected: FAIL with "Cannot find module './fileUploadsMethods.js'".

- [ ] **Step 4: Write the implementation**

```typescript
// src/sdks/tableau/methods/fileUploadsMethods.ts
import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { fileUploadsApis } from '../apis/fileUploadsApi.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { fileUploadSchema, FileUpload } from '../types/fileUpload.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * File Upload methods of the Tableau Server REST API
 *
 * @export
 * @class FileUploadsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm
 */
export default class FileUploadsMethods extends AuthenticatedMethods<typeof fileUploadsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, fileUploadsApis, { axiosConfig }), creds);
  }

  /**
   * Initiates the upload process for a file to be published as a workbook (or data source).
   * Returns an upload session ID used by subsequent Append to File Upload and Publish
   * Workbook calls.
   *
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#initiate_file_upload
   */
  initiateFileUpload = async ({ siteId }: { siteId: string }): Promise<FileUpload> => {
    return (
      await this._apiClient.initiateFileUpload({
        params: { siteId },
        ...this.authHeader,
      })
    ).fileUpload;
  };

  /**
   * Appends a chunk of data to an upload session, to be committed by a later Publish
   * Workbook (or Publish Data Source) call. Sends a `multipart/mixed` body, which
   * Zodios cannot construct, so this bypasses the Zodios-typed client and calls the
   * underlying axios instance directly.
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session ID returned by `initiateFileUpload`
   * @param chunk - The chunk of file bytes to append
   * @param sequenceId - Optional sequence ID for concurrent chunk uploads to the same session
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    chunk,
    sequenceId,
  }: {
    siteId: string;
    uploadSessionId: string;
    chunk: Buffer;
    sequenceId?: string;
  }): Promise<FileUpload> => {
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
      { name: 'tableau_file', filename: 'file', contentType: 'application/octet-stream', data: chunk },
    ]);

    const response = await this._apiClient.axios.put(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/fileUploads/${uploadSessionId}`,
      body,
      {
        params: { sequenceID: sequenceId },
        headers: {
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return fileUploadSchema.parse(response.data.fileUpload);
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/sdks/tableau/methods/fileUploadsMethods.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Lint and commit**

Run: `npm run lint:fix`

```bash
git add src/sdks/tableau/apis/fileUploadsApi.ts src/sdks/tableau/methods/fileUploadsMethods.ts src/sdks/tableau/methods/fileUploadsMethods.test.ts
git commit -m "feat: add FileUploadsMethods (Initiate + Append to File Upload)"
```

---

### Task 4: `publishWorkbook` on `workbooksApi.ts` / `workbooksMethods.ts`

**Files:**
- Modify: `src/sdks/tableau/apis/workbooksApi.ts`
- Modify: `src/sdks/tableau/methods/workbooksMethods.ts`
- Test: `src/sdks/tableau/methods/workbooksMethods.test.ts` (new file — none currently exists for this class)

**Interfaces:**
- Consumes: `buildMultipartMixedBody` from Task 1 (`src/sdks/tableau/multipart.js`); `workbookSchema` / `Workbook` from `src/sdks/tableau/types/workbook.js` (existing).
- Produces: `WorkbooksMethods.publishWorkbook({ siteId, uploadSessionId, workbookType, name, projectId, overwrite }: { siteId: string; uploadSessionId: string; workbookType: 'twb' | 'twbx'; name: string; projectId: string; overwrite?: boolean }): Promise<Workbook>` — consumed by the future (deferred) MCP tool.

- [ ] **Step 1: Add the endpoint definition**

In `src/sdks/tableau/apis/workbooksApi.ts`, add a new endpoint after `addTagsToWorkbookEndpoint` (before the `makeApi([...])` call):

```typescript
const publishWorkbookEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/workbooks',
  alias: 'publishWorkbook',
  description:
    'Publishes a workbook on the specified site, committing a file previously uploaded via Initiate File Upload and Append to File Upload calls.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'uploadSessionId',
      type: 'Query',
      schema: z.string(),
    },
    {
      name: 'workbookType',
      type: 'Query',
      schema: z.enum(['twb', 'twbx']),
    },
    {
      name: 'overwrite',
      type: 'Query',
      schema: z.boolean().optional(),
    },
  ],
  response: z.object({ workbook: workbookSchema }),
});
```

Then add `publishWorkbookEndpoint` to the `makeApi([...])` array:

```typescript
const workbooksApi = makeApi([
  queryWorkbooksForSiteEndpoint,
  getWorkbookEndpoint,
  deleteWorkbookEndpoint,
  addTagsToWorkbookEndpoint,
  publishWorkbookEndpoint,
]);
```

(This endpoint is documentation/typing only, same rationale as `appendToFileUploadEndpoint` in Task 3 — the actual `publishWorkbook` method call bypasses Zodios because the request body is `multipart/mixed`.)

- [ ] **Step 2: Write the failing test**

```typescript
// src/sdks/tableau/methods/workbooksMethods.test.ts
import { describe, expect, it, vi } from 'vitest';

import WorkbooksMethods from './workbooksMethods.js';

describe('WorkbooksMethods', () => {
  describe('publishWorkbook', () => {
    it('POSTs a single-part multipart/mixed body containing the tsRequest XML', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { workbook: { id: 'wb-1', name: 'My Workbook', contentUrl: 'MyWorkbook', showTabs: false, tags: {} } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = { axios: { post: mockPost, defaults: { baseURL: 'http://test' } } };

      const result = await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        name: 'My Workbook',
        projectId: 'project-1',
      });

      expect(result).toMatchObject({ id: 'wb-1', name: 'My Workbook' });
      expect(mockPost).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/workbooks');
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf-8')).toContain(
        '<tsRequest><workbook name="My Workbook"><project id="project-1"/></workbook></tsRequest>',
      );
      expect(body.toString('latin1')).toContain('Content-Disposition: form-data; name="request_payload"');
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
      expect(config.params).toEqual({
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        overwrite: undefined,
      });
    });

    it('escapes XML special characters in the workbook name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { workbook: { id: 'wb-1', name: 'A & B', contentUrl: 'AB', showTabs: false, tags: {} } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = { axios: { post: mockPost, defaults: { baseURL: 'http://test' } } };

      await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        name: 'A & B',
        projectId: 'project-1',
      });

      const body = mockPost.mock.calls[0][1];
      expect(body.toString('utf-8')).toContain('<workbook name="A &amp; B">');
    });

    it('passes overwrite through as a query param when provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { workbook: { id: 'wb-1', name: 'My Workbook', contentUrl: 'MyWorkbook', showTabs: false, tags: {} } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = { axios: { post: mockPost, defaults: { baseURL: 'http://test' } } };

      await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twb',
        name: 'My Workbook',
        projectId: 'project-1',
        overwrite: true,
      });

      const config = mockPost.mock.calls[0][2];
      expect(config.params).toEqual({
        uploadSessionId: 'session-1',
        workbookType: 'twb',
        overwrite: true,
      });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/sdks/tableau/methods/workbooksMethods.test.ts`
Expected: FAIL with "workbooksMethods.publishWorkbook is not a function".

- [ ] **Step 4: Write the implementation**

Add an `escapeXmlAttribute` helper and the `publishWorkbook` method to `src/sdks/tableau/methods/workbooksMethods.ts`. Update the imports and add the method inside the class, after `addTagsToWorkbook`:

```typescript
import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { workbooksApis } from '../apis/workbooksApi.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination } from '../types/pagination.js';
import { Workbook, workbookSchema } from '../types/workbook.js';
import AuthenticatedMethods from './authenticatedMethods.js';
```

(`workbookSchema` is added to the existing `Workbook` import from `../types/workbook.js`.)

```typescript
  /**
   * Publishes a workbook on the specified site, committing a file previously uploaded
   * via `fileUploadsMethods.initiateFileUpload` and `fileUploadsMethods.appendToFileUpload`.
   * Sends a `multipart/mixed` body, which Zodios cannot construct, so this bypasses the
   * Zodios-typed client and calls the underlying axios instance directly.
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session ID returned by `initiateFileUpload`
   * @param workbookType - `twb` or `twbx`, matching the file uploaded to the session
   * @param name - The name to give the published workbook
   * @param projectId - The ID of the project to publish the workbook into
   * @param overwrite - Whether to overwrite an existing workbook with the same name
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook
   */
  publishWorkbook = async ({
    siteId,
    uploadSessionId,
    workbookType,
    name,
    projectId,
    overwrite,
  }: {
    siteId: string;
    uploadSessionId: string;
    workbookType: 'twb' | 'twbx';
    name: string;
    projectId: string;
    overwrite?: boolean;
  }): Promise<Workbook> => {
    const xml = `<tsRequest><workbook name="${escapeXmlAttribute(name)}"><project id="${escapeXmlAttribute(projectId)}"/></workbook></tsRequest>`;
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: xml },
    ]);

    const response = await this._apiClient.axios.post(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/workbooks`,
      body,
      {
        params: { uploadSessionId, workbookType, overwrite },
        headers: {
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return workbookSchema.parse(response.data.workbook);
  };
```

Add the escape helper at module scope, below the class closing brace:

```typescript
function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/sdks/tableau/methods/workbooksMethods.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Lint and commit**

Run: `npm run lint:fix`

```bash
git add src/sdks/tableau/apis/workbooksApi.ts src/sdks/tableau/methods/workbooksMethods.ts src/sdks/tableau/methods/workbooksMethods.test.ts
git commit -m "feat: add WorkbooksMethods.publishWorkbook"
```

---

### Task 5: Wire `fileUploadsMethods` getter into `RestApi`

**Files:**
- Modify: `src/sdks/tableau/restApi.ts`

**Interfaces:**
- Consumes: `FileUploadsMethods` from Task 3 (`src/sdks/tableau/methods/fileUploadsMethods.js`).
- Produces: `RestApi.fileUploadsMethods` getter — the entry point a future MCP tool will call (e.g. `restApi.fileUploadsMethods.initiateFileUpload(...)`, `restApi.fileUploadsMethods.appendToFileUpload(...)`, `restApi.workbooksMethods.publishWorkbook(...)`).

There is no dedicated unit test for `RestApi`'s getters (none of the existing ones — `workbooksMethods`, `datasourcesMethods`, etc. — have one; they're exercised through e2e tests and the tools that consume them). This task is verified via the full unit suite + typecheck in Task 6.

- [ ] **Step 1: Add the import**

In `src/sdks/tableau/restApi.ts`, add (alphabetically, between `DatasourcesMethods` and `FlowsMethods`):

```typescript
import FileUploadsMethods from './methods/fileUploadsMethods.js';
```

- [ ] **Step 2: Add the getter**

Add after the `datasourcesMethods` getter (or anywhere in the getter block — order among getters doesn't matter, only the import order is lint-enforced):

```typescript
  get fileUploadsMethods(): FileUploadsMethods {
    const fileUploadsMethods = new FileUploadsMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, fileUploadsMethods.interceptors);
    return fileUploadsMethods;
  }
```

- [ ] **Step 3: Lint and typecheck**

Run: `npm run lint:fix`
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/sdks/tableau/restApi.ts
git commit -m "feat: wire fileUploadsMethods getter into RestApi"
```

---

### Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests pass, including the 5 new `multipart.test.ts` tests, 3 new `fileUploadsMethods.test.ts` tests, and 3 new `workbooksMethods.test.ts` tests (11 new tests total), with no regressions in the existing suite.

- [ ] **Step 2: Run the build**

Run: `npm run build:dev`
Expected: successful build, no TypeScript errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Show all commits from this plan**

Run: `git log --oneline -6`
Expected: 5 commits from Tasks 1-5 (Task 6 has no commit of its own — it's verification-only).

---

## Self-Review

**Spec coverage:**
- `multipart.ts` (`buildMultipartMixedBody`) — Task 1. ✅
- `types/fileUpload.ts` (`fileUploadSchema`) — Task 2. ✅
- `apis/fileUploadsApi.ts` (`initiateFileUpload`, `appendToFileUpload` endpoint defs) — Task 3. ✅
- `methods/fileUploadsMethods.ts` (`initiateFileUpload`, `appendToFileUpload` methods) — Task 3. ✅
- `apis/workbooksApi.ts` extension (`publishWorkbookEndpoint`) — Task 4. ✅
- `methods/workbooksMethods.ts` extension (`publishWorkbook` method) — Task 4. ✅
- `restApi.ts` extension (`fileUploadsMethods` getter) — Task 5. ✅
- Unit tests mirroring `tasksMethods.test.ts` mocking pattern, plus a dedicated `multipart.test.ts` — Tasks 1, 3, 4. ✅
- Deferred items (chunking helper, single-request publish path, MCP tool) — explicitly excluded from all tasks, no task attempts them. ✅

**Placeholder scan:** No TBD/TODO markers; every code block is complete, runnable code — none are abbreviated with "similar to above" or elided. Checked.

**Type consistency:** `FileUpload`/`fileUploadSchema` (Task 2) used identically in Task 3's `fileUploadsApi.ts` (`response: z.object({ fileUpload: fileUploadSchema })`) and `fileUploadsMethods.ts` (`Promise<FileUpload>`, `fileUploadSchema.parse(...)`). `buildMultipartMixedBody`'s signature (Task 1) matches its two call sites in Task 3 and Task 4 (array of `{ name, filename?, contentType, data }`, returning `{ body, contentType }`). `WorkbooksMethods.publishWorkbook`'s parameter names/types (`siteId`, `uploadSessionId`, `workbookType: 'twb' | 'twbx'`, `name`, `projectId`, `overwrite?: boolean`) are identical between the endpoint's Query-param schemas (Task 4 Step 1) and the method signature (Task 4 Step 4) and the test calls (Task 4 Step 2). `FileUploadsMethods.appendToFileUpload`'s `chunk: Buffer` / `sequenceId?: string` match between method signature and test calls.
