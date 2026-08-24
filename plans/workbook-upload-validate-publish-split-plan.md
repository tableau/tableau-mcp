# Workbook Upload/Validate/Publish Split Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking. Execute task-by-task, in order, running each step's verification before moving on.

**Goal:** Split the fused `publish-workbook` tool into three tools — `upload-workbook` (file-agnostic staging into a Tableau upload session), `validate-workbook` (optional, TWB-only pre-publish check), and a slimmed `publish-workbook` (commit-only) — so a client can upload once and either validate-then-publish or publish directly, with TWB and TWBX handled identically at the upload/publish boundary.

**Architecture:** Extract `resolveWorkbookInput`/`resolveLocalWorkbookFile`/`getWorkbookFileType`-based file resolution into a shared location both new tools call independently (no `uploadSessionId` handoff between `upload-workbook` and `validate-workbook` — they resolve the file separately, since `validate-workbook` needs raw bytes for `validateWorkbookAndUpload` and discards its own upload side effect). `publish-workbook` keeps its existing shape but drops all file-resolution/validation logic, taking `uploadSessionId` + `workbookType` as plain inputs instead of deriving them.

**Tech Stack:** TypeScript, Zod, Vitest, MCP SDK (`@modelcontextprotocol/sdk`), Tableau REST API SDK layer (`src/sdks/tableau/`).

**Spec:** `.work/specs/2026-08-24-workbook-upload-validate-publish-split.md`

## Global Constraints

- REST API version floor: both new tools and `publish-workbook` require Tableau REST API ≥3.29 (same floor as today, checked via `RestApi.versionIsAtLeast('3.29')`).
- Both new tools are gated behind the `authoring-tools` feature flag, same as `request-workbook-upload` and `publish-workbook` today.
- Branch base is `origin/main` — do NOT use `feat/validate-upload-publish-workbook-tool` or any `feat/validate-uploaded-workbook*` branch/worktree; those target a pre-#810 file layout that no longer exists on `main`.
- `publish-workbook` keeps its existing tool name (no further rename after PR #810).
- No backward-compat shim for the old fused `publish-workbook` behavior — this hasn't shipped externally, so the schema change is a breaking change to `publish-workbook`'s params with no deprecation period needed.
- Lint is not part of the validation gate per repo convention (run `npx vitest run` and build; skip `npm run lint` unless asked).

---

## Task 1: Extract shared workbook-input resolution into `stagedWorkbookUpload.ts`

**Files:**
- Modify: `src/tools/web/workbooks/stagedWorkbookUpload.ts`
- Modify: `src/tools/web/workbooks/publishWorkbook.ts` (temporary — will be gutted in Task 4)
- Test: `src/tools/web/workbooks/stagedWorkbookUpload.test.ts` (create if it doesn't exist; check first)

**Interfaces:**
- Consumes: existing `getWorkbookFileType`, `resolveStagedWorkbookUpload`, `ResolvedWorkbook`, `BucketS3Config` type already in `stagedWorkbookUpload.ts` / `s3Client.ts`.
- Produces: `resolveWorkbookInput({config, workbookUploadId, workbookFilePath}): Promise<ResolvedWorkbook>` exported from `stagedWorkbookUpload.ts`. Tasks 2 and 3 both import this. Also produces `resolveLocalWorkbookFile(workbookFilePath: string): Promise<ResolvedWorkbook>` (kept as a named, non-exported helper co-located in the same file, unless a test needs to reach it directly — in which case export it too).

Today `resolveWorkbookInput` and `resolveLocalWorkbookFile` live as private functions at the bottom of `publishWorkbook.ts` (lines 236-286). Both `upload-workbook` and `validate-workbook` need this exact resolution logic, so it must move to a shared module both can import without creating a circular import back through `publishWorkbook.ts`. `stagedWorkbookUpload.ts` is the right home — it already owns `getWorkbookFileType`, `ResolvedWorkbook`, and `resolveStagedWorkbookUpload`.

- [ ] **Step 1: Check for an existing `stagedWorkbookUpload.test.ts`**

Run: `ls src/tools/web/workbooks/stagedWorkbookUpload.test.ts`

If it exists, read it fully before proceeding so Step 2's tests are additive, not duplicative. If it doesn't exist, Step 2 creates it.

- [ ] **Step 2: Write failing tests for `resolveWorkbookInput` in `stagedWorkbookUpload.test.ts`**

Add (or create the file with) these test cases, adapting the existing `describe` block structure if the file already exists:

```typescript
import { readFile } from 'fs/promises';

import {
  getWorkbookFileType,
  resolveWorkbookInput,
} from './stagedWorkbookUpload.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
}));

// NOTE: do not mock resolveStagedWorkbookUpload globally in this file if other
// describe blocks in the same file need the real implementation; use
// vi.spyOn scoped to this describe block instead.

describe('resolveWorkbookInput', () => {
  const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('throws when both workbookFilePath and workbookUploadId are provided', async () => {
    await expect(
      resolveWorkbookInput({
        config: { enabled: true, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: '/tmp/x.twb',
      }),
    ).rejects.toThrow('Provide either workbookFilePath or workbookUploadId, not both.');
  });

  it('throws when neither workbookFilePath nor workbookUploadId are provided', async () => {
    await expect(
      resolveWorkbookInput({
        config: { enabled: true, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
      }),
    ).rejects.toThrow('Either workbookFilePath or workbookUploadId must be provided');
  });

  it('throws when workbookFilePath is provided but staged S3 uploads are configured', async () => {
    await expect(
      resolveWorkbookInput({
        config: { enabled: true, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
        workbookFilePath: '/tmp/x.twb',
      }),
    ).rejects.toThrow('workbookFilePath is only supported when staged S3 uploads are not configured');
  });

  it('throws when workbookUploadId is provided but staged S3 uploads are not configured', async () => {
    await expect(
      resolveWorkbookInput({
        config: { enabled: false, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toThrow('MCP_S3_BUCKET must be configured');
  });

  it('reads a local .twb file when workbookFilePath is provided and S3 is not configured', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('<workbook source="local" />'));

    const result = await resolveWorkbookInput({
      config: { enabled: false, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
      workbookFilePath: '/tmp/source-superstore.twb',
    });

    expect(result).toEqual({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="local" />'),
    });
  });

  it('throws when the local file is neither .twb nor .twbx', async () => {
    await expect(
      resolveWorkbookInput({
        config: { enabled: false, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
        workbookFilePath: '/tmp/source-superstore.xml',
      }),
    ).rejects.toThrow('workbookFilePath must point to a .twb or .twbx file');
  });

  it('throws when the local file is empty', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(''));

    await expect(
      resolveWorkbookInput({
        config: { enabled: false, bucket: 'b', region: 'us-east-1', keyPrefix: '', presignTtlSeconds: 300 },
        workbookFilePath: '/tmp/source-superstore.twb',
      }),
    ).rejects.toThrow('workbookFilePath must not point to an empty workbook file');
  });
});

describe('getWorkbookFileType', () => {
  it('returns twb for .twb files', () => {
    expect(getWorkbookFileType('foo.twb')).toBe('twb');
  });

  it('returns twbx for .twbx files', () => {
    expect(getWorkbookFileType('foo.twbx')).toBe('twbx');
  });

  it('returns undefined for other extensions', () => {
    expect(getWorkbookFileType('foo.xml')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run src/tools/web/workbooks/stagedWorkbookUpload.test.ts`
Expected: FAIL — `resolveWorkbookInput` is not exported from `./stagedWorkbookUpload.js` yet.

- [ ] **Step 4: Move `resolveWorkbookInput` and `resolveLocalWorkbookFile` into `stagedWorkbookUpload.ts`**

In `src/tools/web/workbooks/stagedWorkbookUpload.ts`, add these imports at the top:

```typescript
import { readFile } from 'fs/promises';
import { basename } from 'path';
```

Then add, near the bottom of the file (after `getWorkbookUploadContentType`):

```typescript
export async function resolveWorkbookInput({
  config,
  workbookUploadId,
  workbookFilePath,
}: {
  config: BucketS3Config & { enabled: boolean };
  workbookUploadId?: string;
  workbookFilePath?: string;
}): Promise<ResolvedWorkbook> {
  if (workbookUploadId && workbookFilePath) {
    throw new Error('Provide either workbookFilePath or workbookUploadId, not both.');
  }

  if (workbookFilePath) {
    if (config.enabled) {
      throw new Error(
        'workbookFilePath is only supported when staged S3 uploads are not configured. Call request-workbook-upload first and pass workbookUploadId.',
      );
    }
    return await resolveLocalWorkbookFile(workbookFilePath);
  }

  if (!workbookUploadId) {
    throw new Error(
      'Either workbookFilePath or workbookUploadId must be provided. For local MCP servers, pass workbookFilePath. For hosted clients, call request-workbook-upload first and pass workbookUploadId.',
    );
  }
  if (!config.enabled) {
    throw new Error(
      'MCP_S3_BUCKET must be configured before publishing staged workbook uploads.',
    );
  }
  return await resolveStagedWorkbookUpload({
    workbookUploadId,
    config,
  });
}

async function resolveLocalWorkbookFile(workbookFilePath: string): Promise<ResolvedWorkbook> {
  const fileName = basename(workbookFilePath);
  if (!getWorkbookFileType(fileName)) {
    throw new Error('workbookFilePath must point to a .twb or .twbx file.');
  }

  const bytes = await readFile(workbookFilePath);
  if (bytes.byteLength === 0) {
    throw new Error('workbookFilePath must not point to an empty workbook file.');
  }

  return { fileName, bytes };
}
```

**Important:** these use plain `Error`, not `ArgsValidationError`/`UnknownError` from `../../../errors/mcpToolError.js`, because `stagedWorkbookUpload.ts` currently has no dependency on the tool-error module (check with `grep -n "mcpToolError" src/tools/web/workbooks/stagedWorkbookUpload.ts` — if it returns nothing, keep plain `Error` to avoid introducing a new coupling; the calling tool files already catch and wrap errors via `tool.logAndExecute`, which is error-message-content-agnostic). If `grep` shows `stagedWorkbookUpload.ts` already imports `mcpToolError.js` for other reasons, use `ArgsValidationError`/`UnknownError` instead to match repo convention — check current file state before writing this step's final code.

- [ ] **Step 5: Remove `resolveWorkbookInput`/`resolveLocalWorkbookFile` from `publishWorkbook.ts` and import from `stagedWorkbookUpload.ts` instead**

In `src/tools/web/workbooks/publishWorkbook.ts`:
- Delete the `resolveWorkbookInput` function (lines 236-272) and `resolveLocalWorkbookFile` function (lines 274-286).
- Delete the now-unused imports: `readFile` from `'fs/promises'` (line 2), `basename` from `'path'` (line 3), `ArgsValidationError` (if `resolveWorkbookInput`/`resolveLocalWorkbookFile` were its only callers — check remaining usages with `grep -n ArgsValidationError src/tools/web/workbooks/publishWorkbook.ts` before deleting the import).
- Add `resolveWorkbookInput` to the existing import from `./stagedWorkbookUpload.js`:

```typescript
import {
  getWorkbookFileType,
  resolveWorkbookInput,
  type ResolvedWorkbook,
} from './stagedWorkbookUpload.js';
```

(Drop `resolveStagedWorkbookUpload` from this import list if `publishWorkbook.ts` no longer references it directly after this change — check with `grep -n resolveStagedWorkbookUpload src/tools/web/workbooks/publishWorkbook.ts`.)

- [ ] **Step 6: Run the full existing `publishWorkbook.test.ts` suite plus the new `stagedWorkbookUpload.test.ts` to confirm nothing broke**

Run: `npx vitest run src/tools/web/workbooks/publishWorkbook.test.ts src/tools/web/workbooks/stagedWorkbookUpload.test.ts`
Expected: ALL PASS. `publishWorkbook.test.ts` still passes unchanged because `publishWorkbook.ts`'s external behavior hasn't changed yet — only where the resolution code lives.

- [ ] **Step 7: Commit**

```bash
git add src/tools/web/workbooks/stagedWorkbookUpload.ts src/tools/web/workbooks/stagedWorkbookUpload.test.ts src/tools/web/workbooks/publishWorkbook.ts
git commit -m "refactor: move workbook input resolution into stagedWorkbookUpload.ts"
```

---

## Task 2: Create the `upload-workbook` tool (file-agnostic)

**Files:**
- Create: `src/tools/web/workbooks/uploadWorkbook.ts`
- Test: `src/tools/web/workbooks/uploadWorkbook.test.ts`

**Interfaces:**
- Consumes: `resolveWorkbookInput`, `getWorkbookFileType` from `./stagedWorkbookUpload.js` (Task 1). `RestApi.versionIsAtLeast` from `../../../sdks/tableau/restApi.js`. `restApi.publishingMethods.uploadFileInChunks({siteId, filename, content}): Promise<string>` (existing SDK method, unchanged).
- Produces: `getUploadWorkbookTool(server: WebMcpServer): WebTool<typeof paramsSchema>`, tool name `'upload-workbook'`, result shape `{uploadSessionId: string, workbookType: 'twb' | 'twbx'}`. Task 4 (`publish-workbook`) consumes this result shape as its input shape (minus `name`/`projectId`/`overwrite`, which publish adds).

- [ ] **Step 1: Write the failing test file `uploadWorkbook.test.ts`**

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getUploadWorkbookTool } from './uploadWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockUploadFileInChunks: vi.fn(),
  mockResolveStagedWorkbookUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      publishingMethods: {
        uploadFileInChunks: mocks.mockUploadFileInChunks,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
  resolveStagedWorkbookUpload: mocks.mockResolveStagedWorkbookUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

describe('uploadWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockUploadFileInChunks.mockReset();
    mocks.mockResolveStagedWorkbookUpload.mockReset();
    mocks.mockReadFile.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getUploadWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('upload-workbook');
    expect(paramsSchema).toMatchObject({
      workbookUploadId: expect.any(Object),
      workbookFilePath: expect.any(Object),
    });
    expect(annotations.destructiveHint).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getUploadWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('uploads a .twb staged workbook via the generic chunked-upload path and returns workbookType twb', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toEqual({
      uploadSessionId: 'chunked-upload-session-id',
      workbookType: 'twb',
    });
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      content: Buffer.from('<workbook source="new" />'),
    });
  });

  it('uploads a .twbx staged workbook via the same chunked-upload path and returns workbookType twbx', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twbx',
      bytes: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id-2');

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toEqual({
      uploadSessionId: 'chunked-upload-session-id-2',
      workbookType: 'twbx',
    });
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twbx',
      content: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
  });

  it('uploads a local workbook file path when staged S3 uploads are not configured', async () => {
    mocks.mockReadFile.mockResolvedValue(Buffer.from('<workbook source="local" />'));
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id-3');

    const result = await getToolResult(
      { workbookFilePath: '/tmp/source-superstore.twb' },
      { bucketS3Enabled: false },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.twb');
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      uploadSessionId: 'chunked-upload-session-id-3',
      workbookType: 'twb',
    });
  });

  it('returns an error when neither workbookFilePath nor workbookUploadId is provided', async () => {
    const result = await getToolResult({});

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Either workbookFilePath or workbookUploadId');
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an error when both workbookFilePath and workbookUploadId are provided', async () => {
    const result = await getToolResult({
      workbookFilePath: '/tmp/x.twb',
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Provide either workbookFilePath or workbookUploadId, not both');
  });

  it('returns a clear compatibility error on REST API versions before 3.29', async () => {
    const originalVersionIsAtLeast = RestApi.versionIsAtLeast;
    RestApi.version = '3.28';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    }).finally(() => {
      RestApi.versionIsAtLeast = originalVersionIsAtLeast;
      RestApi.version = '3.29';
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau REST API version 3.29 or later');
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('redacts staged workbookUploadId details passed to shared logging', async () => {
    const tool = getUploadWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: undefined,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookUploadId: '<redacted>',
      workbookFilePath: undefined,
    });
  });
});

async function getToolResult(
  params: { workbookUploadId?: string; workbookFilePath?: string },
  options: { bucketS3Enabled?: boolean } = {},
): Promise<CallToolResult> {
  const tool = getUploadWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockExtra(options));
}

function getMockExtra({
  bucketS3Enabled = true,
}: { bucketS3Enabled?: boolean } = {}): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    config: {
      ...extra.config,
      bucketS3: {
        enabled: bucketS3Enabled,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
    },
  };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tools/web/workbooks/uploadWorkbook.test.ts`
Expected: FAIL — `./uploadWorkbook.js` does not exist.

- [ ] **Step 3: Implement `uploadWorkbook.ts`**

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getWorkbookFileType, resolveWorkbookInput } from './stagedWorkbookUpload.js';

const paramsSchema = {
  workbookUploadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Staged workbook upload id returned by request-workbook-upload. Use this for hosted clients that cannot pass a local path.',
    ),
  workbookFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when staged S3 uploads are not configured.',
    ),
};

export type UploadWorkbookResult = {
  uploadSessionId: string;
  workbookType: 'twb' | 'twbx';
};

export const getUploadWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'upload-workbook',
    description:
      'Uploads a TWB or TWBX workbook from a local file path or staged upload id into a Tableau file upload session, without validating or publishing it. Returns an uploadSessionId and workbookType to pass to validate-workbook and/or publish-workbook. Handles TWB and TWBX identically.',
    paramsSchema,
    annotations: {
      title: 'Upload Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async ({ workbookUploadId, workbookFilePath }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<UploadWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
        },
        callback: async () => {
          assertMinimumRestApiVersionSupported();

          const result = await useRestApi<UploadWorkbookResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolvedWorkbookFile = await resolveWorkbookInput({
                config: extra.config.bucketS3,
                workbookUploadId,
                workbookFilePath,
              });
              const workbookType = getWorkbookFileType(resolvedWorkbookFile.fileName);
              if (!workbookType) {
                throw new UnknownError(
                  `Resolved workbook file "${resolvedWorkbookFile.fileName}" is neither a .twb nor a .twbx file.`,
                );
              }

              const uploadSessionId = await restApi.publishingMethods.uploadFileInChunks({
                siteId: restApi.siteId,
                filename: resolvedWorkbookFile.fileName,
                content: resolvedWorkbookFile.bytes,
              });

              return { uploadSessionId, workbookType };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

function assertMinimumRestApiVersionSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `upload-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tools/web/workbooks/uploadWorkbook.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/web/workbooks/uploadWorkbook.ts src/tools/web/workbooks/uploadWorkbook.test.ts
git commit -m "feat: add file-agnostic upload-workbook tool"
```

---

## Task 3: Create the `validate-workbook` tool (optional, TWB-only check)

**Files:**
- Create: `src/tools/web/workbooks/validateWorkbook.ts`
- Test: `src/tools/web/workbooks/validateWorkbook.test.ts`

**Interfaces:**
- Consumes: `resolveWorkbookInput`, `getWorkbookFileType` from `./stagedWorkbookUpload.js` (Task 1). `restApi.workbooksMethods.validateWorkbookAndUpload({siteId, filename, workbook}): Promise<WorkbookValidationResult>` (existing SDK method, unchanged). `ValidationIssue` type from `../../../sdks/tableau/types/workbookValidation.js`.
- Produces: `getValidateWorkbookTool(server: WebMcpServer): WebTool<typeof paramsSchema>`, tool name `'validate-workbook'`, result type `ValidateWorkbookResult = {status: 'invalid', errors: ValidationFinding[], warnings: ValidationFinding[]} | {status: 'valid', warnings: ValidationFinding[]}`. Also exports the `ValidationFinding` type (previously private to `publishWorkbook.ts`) since it's now this tool's public result shape.

- [ ] **Step 1: Write the failing test file `validateWorkbook.test.ts`**

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookTool } from './validateWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockValidateWorkbookAndUpload: vi.fn(),
  mockResolveStagedWorkbookUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        validateWorkbookAndUpload: mocks.mockValidateWorkbookAndUpload,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
  resolveStagedWorkbookUpload: mocks.mockResolveStagedWorkbookUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

describe('validateWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockValidateWorkbookAndUpload.mockReset();
    mocks.mockResolveStagedWorkbookUpload.mockReset();
    mocks.mockReadFile.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getValidateWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);

    expect(tool.name).toBe('validate-workbook');
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.readOnlyHint).toBe(true);
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getValidateWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('returns valid with warnings for a .twb workbook that passes Tableau validation', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'throwaway-upload-id',
      warnings: [
        {
          severity: 'WARNING',
          message: 'Unknown map source is used',
          line: 245,
          column: 18,
          elementName: 'map',
        },
      ],
    });

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toEqual({
      status: 'valid',
      warnings: [
        {
          severity: 'WARNING',
          message: 'Unknown map source is used',
          line: 245,
          column: 18,
          elementName: 'map',
        },
      ],
    });
    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="new" />'),
    });
  });

  it('returns invalid with errors and does not include an uploadSessionId when Tableau rejects a .twb workbook', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 127,
          column: 5,
          elementName: 'preferences',
        },
      ],
    });

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toEqual({
      status: 'invalid',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 127,
          column: 5,
          elementName: 'preferences',
        },
      ],
      warnings: [],
    });
    expect(response.uploadSessionId).toBeUndefined();
  });

  it('is a no-op that always returns valid with no warnings for .twbx files, without calling Tableau', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twbx',
      bytes: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({ status: 'valid', warnings: [] });
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an error and does not report valid when Tableau validation succeeds but returns no uploadId', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
    });

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not return an uploadId');
  });

  it('returns a clear compatibility error on REST API versions before 3.29', async () => {
    const originalVersionIsAtLeast = RestApi.versionIsAtLeast;
    RestApi.version = '3.28';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);

    const result = await getToolResult({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
    }).finally(() => {
      RestApi.versionIsAtLeast = originalVersionIsAtLeast;
      RestApi.version = '3.29';
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau REST API version 3.29 or later');
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('redacts staged workbookUploadId details passed to shared logging', async () => {
    const tool = getValidateWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: undefined,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookUploadId: '<redacted>',
      workbookFilePath: undefined,
    });
  });
});

async function getToolResult(
  params: { workbookUploadId?: string; workbookFilePath?: string },
  options: { bucketS3Enabled?: boolean } = {},
): Promise<CallToolResult> {
  const tool = getValidateWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockExtra(options));
}

function getMockExtra({
  bucketS3Enabled = true,
}: { bucketS3Enabled?: boolean } = {}): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    config: {
      ...extra.config,
      bucketS3: {
        enabled: bucketS3Enabled,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
    },
  };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tools/web/workbooks/validateWorkbook.test.ts`
Expected: FAIL — `./validateWorkbook.js` does not exist.

- [ ] **Step 3: Implement `validateWorkbook.ts`**

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getWorkbookFileType, resolveWorkbookInput } from './stagedWorkbookUpload.js';

const paramsSchema = {
  workbookUploadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Staged workbook upload id returned by request-workbook-upload. Use this for hosted clients that cannot pass a local path.',
    ),
  workbookFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when staged S3 uploads are not configured.',
    ),
};

export type ValidationFinding = {
  severity: string;
  message: string;
  line: number;
  column: number;
  elementName: string;
};

export type ValidateWorkbookResult =
  | { status: 'invalid'; errors: ValidationFinding[]; warnings: ValidationFinding[] }
  | { status: 'valid'; warnings: ValidationFinding[] };

export const getValidateWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'validate-workbook',
    description:
      'Validates a TWB workbook from a local file path or staged upload id and returns any errors or warnings, without uploading a session for publishing or publishing it. This is an optional pre-publish check. TWBX workbooks cannot be validated by Tableau ahead of publishing (Tableau can only validate the inner TWB XML, not extracts packaged inside a TWBX), so calling this on a TWBX is a no-op that always returns status "valid" with no warnings.',
    paramsSchema,
    annotations: {
      title: 'Validate Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async ({ workbookUploadId, workbookFilePath }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ValidateWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
        },
        callback: async () => {
          assertMinimumRestApiVersionSupported();

          const result = await useRestApi<ValidateWorkbookResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolvedWorkbookFile = await resolveWorkbookInput({
                config: extra.config.bucketS3,
                workbookUploadId,
                workbookFilePath,
              });
              const workbookType = getWorkbookFileType(resolvedWorkbookFile.fileName);
              if (!workbookType) {
                throw new UnknownError(
                  `Resolved workbook file "${resolvedWorkbookFile.fileName}" is neither a .twb nor a .twbx file.`,
                );
              }

              if (workbookType === 'twbx') {
                return { status: 'valid' as const, warnings: [] };
              }

              const validation = await restApi.workbooksMethods.validateWorkbookAndUpload({
                siteId: restApi.siteId,
                filename: resolvedWorkbookFile.fileName,
                workbook: resolvedWorkbookFile.bytes,
              });

              const errors = (validation.errors ?? []).map(toValidationFinding);
              const warnings = (validation.warnings ?? []).map(toValidationFinding);

              if (errors.length > 0) {
                return { status: 'invalid' as const, errors, warnings };
              }

              if (!validation.uploadId) {
                throw new UnknownError(
                  'Tableau validation succeeded but did not return an uploadId.',
                );
              }

              return { status: 'valid' as const, warnings };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

function assertMinimumRestApiVersionSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `validate-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
}

function toValidationFinding(issue: ValidationIssue): ValidationFinding {
  return {
    severity: sanitizeFindingText(issue.severity, 100),
    message: sanitizeFindingText(issue.message, 2_000),
    line: issue.line,
    column: issue.column,
    elementName: sanitizeFindingText(issue.elementName, 255),
  };
}

function sanitizeFindingText(value: string, maxLength: number): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, maxLength);
}
```

Note: this discards `validation.uploadId` deliberately — that upload session is never the one `publish-workbook` commits (see spec's "Why upload and validate can't both be file-agnostic and coupled").

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tools/web/workbooks/validateWorkbook.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/web/workbooks/validateWorkbook.ts src/tools/web/workbooks/validateWorkbook.test.ts
git commit -m "feat: add optional twb-only validate-workbook tool"
```

---

## Task 4: Slim `publish-workbook` down to commit-only

**Files:**
- Modify: `src/tools/web/workbooks/publishWorkbook.ts`
- Modify: `src/tools/web/workbooks/publishWorkbook.test.ts`

**Interfaces:**
- Consumes: `{uploadSessionId, workbookType}` — the exact result shape produced by Task 2's `upload-workbook` (field names must match: `uploadSessionId: string`, `workbookType: 'twb' | 'twbx'`).
- Produces: `PublishWorkbookResult = {status: 'published', data: Workbook, url: string} | never-invalid-branch-removed`. **Breaking change from today:** `publish-workbook` no longer returns `status: 'invalid'` or `warnings` — invalidity is now `validate-workbook`'s concern, and publish either succeeds or throws (e.g. Tableau rejects the commit outright, which surfaces as a tool error, not a structured `invalid` result). If Tableau's publish REST call can itself reject with validation-shaped errors (check by re-reading `workbooksMethods.ts:213-253`'s error handling — does it ever return anything other than throw-or-Workbook?), keep the result type a plain `{status: 'published', data, url}` non-union object, since publish only ever succeeds or throws.

- [ ] **Step 1: Update `publishWorkbook.test.ts` to the new schema — replace fixture data**

Rewrite the test file's `validArgs`/`validLocalArgs` fixtures and remove all TWB-validation-path/TWBX-chunked-upload-path assertions (those moved to `uploadWorkbook.test.ts`/`validateWorkbook.test.ts` in Tasks 2-3). Keep only publish-specific behavior: overwrite semantics, bounded-context check, version gate, URL construction, duplicate-name rejection, log redaction. Replace the whole file with:

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getPublishWorkbookTool } from './publishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockPublishWorkbook: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        publishWorkbook: mocks.mockPublishWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const validArgs = {
  uploadSessionId: 'upload-session-id',
  workbookType: 'twb' as const,
  name: 'My New Workbook',
  projectId: 'target-project-id',
};

describe('publishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockPublishWorkbook.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('publish-workbook');
    expect(paramsSchema).toMatchObject({
      uploadSessionId: expect.any(Object),
      workbookType: expect.any(Object),
      name: expect.any(Object),
      projectId: expect.any(Object),
      overwrite: expect.any(Object),
    });
    expect(annotations.destructiveHint).toBe(true);
    expect(paramsSchema.name.safeParse('').success).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getPublishWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when the authoring-tools feature flag is ON', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('publishes to the requested project using the given uploadSessionId and workbookType', async () => {
    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'upload-session-id',
      name: 'My New Workbook',
      workbookType: 'twb',
      projectId: 'target-project-id',
      overwrite: false,
    });
  });

  it('publishes a twbx uploadSessionId with workbookType twbx passed through unchanged', async () => {
    await getToolResult({ ...validArgs, workbookType: 'twbx' });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ workbookType: 'twbx' }),
    );
  });

  it('defaults overwrite to false when publishing', async () => {
    await getToolResult(validArgs);

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it('returns an error without overwriting when Tableau rejects a duplicate workbook name', async () => {
    mocks.mockPublishWorkbook.mockRejectedValue(
      new Error('A workbook named My New Workbook already exists in the target project.'),
    );

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('already exists in the target project');
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Workbook', overwrite: false }),
    );
  });

  it('passes overwrite true through when publishing', async () => {
    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('returns an error when the requested project is outside bounded context', async () => {
    const result = await getToolResult(validArgs, {
      boundedProjectIds: new Set(['different-project-id']),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed by this MCP server');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('returns a clear compatibility error on REST API versions before 3.29', async () => {
    const originalVersionIsAtLeast = RestApi.versionIsAtLeast;
    RestApi.version = '3.28';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);

    const result = await getToolResult(validArgs).finally(() => {
      RestApi.versionIsAtLeast = originalVersionIsAtLeast;
      RestApi.version = '3.29';
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau REST API version 3.29 or later');
    expect(result.content[0].text).toContain('REST API version 3.28');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('redacts uploadSessionId details passed to shared logging', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        uploadSessionId: 'upload-session-id',
        workbookType: 'twb',
        name: validArgs.name,
        projectId: validArgs.projectId,
        overwrite: false,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      uploadSessionId: '<redacted>',
      workbookType: 'twb',
      name: validArgs.name,
      projectId: validArgs.projectId,
      overwrite: false,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain('upload-session-id');
  });
});

async function getToolResult(
  params: {
    uploadSessionId: string;
    workbookType: 'twb' | 'twbx';
    name: string;
    projectId: string;
    overwrite?: boolean;
  },
  options: { boundedProjectIds?: Set<string> | null } = {},
): Promise<CallToolResult> {
  const tool = getPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      uploadSessionId: params.uploadSessionId,
      workbookType: params.workbookType,
      name: params.name,
      projectId: params.projectId,
      overwrite: params.overwrite ?? false,
    },
    getMockExtra(options),
  );
}

function getMockExtra({
  boundedProjectIds = null,
}: { boundedProjectIds?: Set<string> | null } = {}): ReturnType<
  typeof getMockRequestHandlerExtra
> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      boundedContext: {
        projectIds: boundedProjectIds,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  };
}
```

- [ ] **Step 2: Run to verify it fails against the current (unslimmed) `publishWorkbook.ts`**

Run: `npx vitest run src/tools/web/workbooks/publishWorkbook.test.ts`
Expected: FAIL — the current `paramsSchema` has no `uploadSessionId`/`workbookType` fields, so the callback under test is still resolving files/validating rather than accepting a pre-made session id.

- [ ] **Step 3: Rewrite `publishWorkbook.ts` to commit-only**

Replace the entire file with:

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ProjectNotAllowedError, UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  uploadSessionId: z
    .string()
    .min(1)
    .describe('Tableau upload session id returned by upload-workbook.'),
  workbookType: z
    .enum(['twb', 'twbx'])
    .describe('Workbook file type, as returned by upload-workbook.'),
  name: z.string().min(1).describe('The name to give the published workbook.'),
  projectId: z
    .string()
    .min(1)
    .describe(
      'The Tableau project LUID to publish the workbook into. Use list-projects to discover available project IDs.',
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Whether to overwrite an existing workbook with the same name in the target project. Defaults to false.',
    ),
};

export type PublishWorkbookResult = {
  status: 'published';
  data: Workbook;
  url: string;
};

export const getPublishWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'publish-workbook',
    description:
      'Commits a previously uploaded TWB or TWBX workbook (via upload-workbook) to the specified Tableau project. Use list-projects to discover project IDs. Call validate-workbook first if you want pre-publish validation errors/warnings for a TWB workbook.',
    paramsSchema,
    annotations: {
      title: 'Publish Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async (
      { uploadSessionId, workbookType, name, projectId, overwrite = false },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<PublishWorkbookResult>({
        extra,
        args: {
          uploadSessionId: uploadSessionId ? '<redacted>' : undefined,
          workbookType,
          name,
          projectId,
          overwrite,
        },
        callback: async () => {
          assertMinimumRestApiVersionSupported();
          const configWithOverrides = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);

          const result = await useRestApi<PublishWorkbookResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const publishedWorkbook = await restApi.workbooksMethods.publishWorkbook({
                siteId: restApi.siteId,
                uploadSessionId,
                name,
                workbookType,
                projectId,
                overwrite,
              });

              const url =
                getDefaultViewWebUrl(publishedWorkbook, extra.config.server, extra.getSiteName()) ??
                publishedWorkbook.webpageUrl ??
                '';

              return {
                status: 'published' as const,
                data: publishedWorkbook,
                url,
              };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

function assertMinimumRestApiVersionSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `publish-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
}

function assertProjectAllowedByBoundedContext(
  projectId: string,
  boundedContext: BoundedContext,
): void {
  const { projectIds } = boundedContext;
  if (projectIds && !projectIds.has(projectId)) {
    throw new ProjectNotAllowedError(
      `Publishing to project with LUID ${projectId} is not allowed by this MCP server's bounded project context.`,
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tools/web/workbooks/publishWorkbook.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/web/workbooks/publishWorkbook.ts src/tools/web/workbooks/publishWorkbook.test.ts
git commit -m "refactor: slim publish-workbook down to commit-only, taking uploadSessionId+workbookType"
```

---

## Task 5: Register the new tools

**Files:**
- Modify: `src/tools/web/tools.ts`
- Modify: `src/tools/web/toolName.ts`
- Modify: `src/server/oauth/scopes.ts`

**Interfaces:**
- Consumes: `getUploadWorkbookTool` (Task 2), `getValidateWorkbookTool` (Task 3).
- Produces: `'upload-workbook'` and `'validate-workbook'` become valid `WebToolName` values usable everywhere that type is referenced (e.g. `isWebToolName`, scope maps).

- [ ] **Step 1: Add imports and factory entries to `tools.ts`**

In `src/tools/web/tools.ts`, add two imports alongside the existing workbook imports (after line 39, before line 40 in current file, keeping alphabetical grouping with the other `workbooks/` imports):

```typescript
import { getPublishWorkbookTool } from './workbooks/publishWorkbook.js';
import { getRequestWorkbookUploadTool } from './workbooks/requestWorkbookUpload.js';
import { getUploadWorkbookTool } from './workbooks/uploadWorkbook.js';
import { getValidateWorkbookTool } from './workbooks/validateWorkbook.js';
```

(Full corrected import block: `getDownloadWorkbookTool`, `getGetWorkbookTool`, `getListWorkbooksTool`, `getPublishWorkbookTool`, `getRequestWorkbookUploadTool`, `getUploadWorkbookTool`, `getValidateWorkbookTool` — alphabetical by import path.)

Then update the `webToolFactories` array (currently lines 45-89) so the authoring tools appear in flow order:

```typescript
  getRequestWorkbookUploadTool,
  getUploadWorkbookTool,
  getValidateWorkbookTool,
  getPublishWorkbookTool,
```

(replacing the existing two-line `getRequestWorkbookUploadTool, getPublishWorkbookTool,` block at current lines 72-73).

- [ ] **Step 2: Add tool names and update the `authoring` group in `toolName.ts`**

In `src/tools/web/toolName.ts`, in the `webToolNames` array, replace:

```typescript
  'request-workbook-upload',
  'publish-workbook',
```

with:

```typescript
  'request-workbook-upload',
  'upload-workbook',
  'validate-workbook',
  'publish-workbook',
```

In the `webToolGroups` object, replace:

```typescript
  authoring: ['request-workbook-upload', 'publish-workbook'],
```

with:

```typescript
  authoring: ['request-workbook-upload', 'upload-workbook', 'validate-workbook', 'publish-workbook'],
```

- [ ] **Step 3: Add OAuth scope entries in `scopes.ts`**

In `src/server/oauth/scopes.ts`, in the `toolScopeMap` object, replace:

```typescript
  'publish-workbook': {
    mcp: ['tableau:mcp:workbook:create'],
    api: new Set(['tableau:workbooks:create', 'tableau:file_uploads:create']),
  },
```

with (upload-workbook takes over the `file_uploads:create` scope since it's now the tool that calls `uploadFileInChunks`; validate-workbook needs `workbooks:create` since it calls `validateWorkbookAndUpload`; publish-workbook keeps `workbooks:create` since it calls the commit endpoint):

```typescript
  'upload-workbook': {
    mcp: ['tableau:mcp:workbook:create'],
    api: new Set(['tableau:file_uploads:create']),
  },
  'validate-workbook': {
    mcp: ['tableau:mcp:workbook:create'],
    api: new Set(['tableau:workbooks:create']),
  },
  'publish-workbook': {
    mcp: ['tableau:mcp:workbook:create'],
    api: new Set(['tableau:workbooks:create']),
  },
```

Then update the `authoringToolsEnabled` gating block (currently lines 428-432):

```typescript
  if (!authoringToolsEnabled) {
    enabledTools.delete('request-workbook-upload');
    enabledTools.delete('upload-workbook');
    enabledTools.delete('validate-workbook');
    enabledTools.delete('publish-workbook');
    enabledTools.delete('download-workbook');
  }
```

Before finalizing this step, run `grep -n "'publish-workbook'" src/server/oauth/scopes.ts` to confirm there are no other references to `publish-workbook`'s scope entry elsewhere in the file (e.g. a test fixture or another gating block) that also need updating.

- [ ] **Step 4: Run the full unit test suite**

Run: `npx vitest run`
Expected: PASS. Pay particular attention to any existing test in `src/server/oauth/scopes.test.ts` (if it exists — check with `ls src/server/oauth/scopes.test.ts`) that snapshots the full `toolScopeMap` or `webToolNames`/`webToolGroups` shape; such a test will need its expected tool list/count updated to include `upload-workbook` and `validate-workbook`.

- [ ] **Step 5: Run `npx tsc` to confirm no type errors**

Run: `npx tsc --noEmit` (or the repo's existing build/typecheck script — check `package.json` for the exact script name if `tsc --noEmit` isn't directly configured)
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools/web/tools.ts src/tools/web/toolName.ts src/server/oauth/scopes.ts
git commit -m "feat: register upload-workbook and validate-workbook tools"
```

---

## Task 6: Update e2e tests

**Files:**
- Create: `tests/e2e/workbooks/uploadWorkbook.test.ts`
- Create: `tests/e2e/workbooks/validateWorkbook.test.ts`
- Modify: `tests/e2e/workbooks/publishWorkbook.test.ts`

**Interfaces:**
- Consumes: `McpClient.callTool` pattern already used in `tests/e2e/workbooks/publishWorkbook.test.ts` (read that file's existing helpers: `getDefaultEnv`, `resetEnv`, `setEnv`, `buildVariant`, `McpClient`, and the `authoringToolsFeatureGate.cjs` fixture at `tests/e2e/fixtures/authoringToolsFeatureGate.cjs` — reuse verbatim).

- [ ] **Step 1: Read the fixture files referenced by the existing e2e test to confirm they still apply unchanged**

Run: `cat tests/e2e/fixtures/authoringToolsFeatureGate.cjs` and confirm `tests/e2e/fixtures/workbooks/superstore-datasource.twb` and `tests/e2e/fixtures/workbooks/forecast.twbx` exist (`ls tests/e2e/fixtures/workbooks/`). These are reused as-is by all three e2e test files below — no changes needed to the fixtures themselves.

- [ ] **Step 2: Create `tests/e2e/workbooks/uploadWorkbook.test.ts`**

```typescript
import { resolve } from 'path';
import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const uploadWorkbookResultSchema = z.object({
  uploadSessionId: z.string(),
  workbookType: z.enum(['twb', 'twbx']),
});

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');

describe('upload-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getUploadWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('uploads a .twb file and returns workbookType twb', async () => {
    const result = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: defaultWorkbookFilePath },
    });

    expect(result.workbookType).toBe('twb');
    expect(result.uploadSessionId).toEqual(expect.any(String));
  });

  it('uploads a .twbx file and returns workbookType twbx', async () => {
    const result = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    expect(result.workbookType).toBe('twbx');
    expect(result.uploadSessionId).toEqual(expect.any(String));
  });
});

function getUploadWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
```

- [ ] **Step 3: Create `tests/e2e/workbooks/validateWorkbook.test.ts`**

```typescript
import { resolve } from 'path';
import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const validationFindingSchema = z.object({
  severity: z.string(),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  elementName: z.string(),
});

const validateWorkbookResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid'), warnings: z.array(validationFindingSchema) }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(validationFindingSchema),
    warnings: z.array(validationFindingSchema),
  }),
]);

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');

describe('validate-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getValidateWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('validates a .twb file and reports status valid', async () => {
    const result = await client!.callTool('validate-workbook', {
      schema: validateWorkbookResultSchema,
      toolArgs: { workbookFilePath: defaultWorkbookFilePath },
    });

    expect(result.status).toBe('valid');
  });

  it('is a no-op that reports status valid for a .twbx file without contacting Tableau for validation', async () => {
    const result = await client!.callTool('validate-workbook', {
      schema: validateWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    expect(result).toEqual({ status: 'valid', warnings: [] });
  });
});

function getValidateWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
```

- [ ] **Step 4: Rewrite `tests/e2e/workbooks/publishWorkbook.test.ts` to chain through `upload-workbook` first**

Replace the file's two `it` blocks so they call `upload-workbook` to get a real `uploadSessionId`/`workbookType`, then pass those into `publish-workbook`:

```typescript
import { resolve } from 'path';
import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const uploadWorkbookResultSchema = z.object({
  uploadSessionId: z.string(),
  workbookType: z.enum(['twb', 'twbx']),
});

const publishWorkbookResultSchema = z.object({
  status: z.literal('published'),
  data: workbookSchema,
  url: z.string(),
});

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');
const defaultProjectId = 'd87d843b-4326-4ce3-bc50-a68c1e6c9ca5';

type PublishWorkbookSmokeConfig = {
  workbookFilePath: string;
  workbookName: string;
  projectId: string;
};

describe('publish-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getPublishWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('uploads then publishes a workbook (.twb) from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    const uploadResult = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: smokeConfig.workbookFilePath },
    });

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        uploadSessionId: uploadResult.uploadSessionId,
        workbookType: uploadResult.workbookType,
        name: smokeConfig.workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    expect(publishResult.data.name).toBe(smokeConfig.workbookName);
    expect(publishResult.url).toEqual(expect.any(String));
  });

  it('uploads then publishes a .twbx workbook from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    const workbookName = `${smokeConfig.workbookName} TWBX`;

    const uploadResult = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        uploadSessionId: uploadResult.uploadSessionId,
        workbookType: uploadResult.workbookType,
        name: workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    expect(publishResult.data.name).toBe(workbookName);
    expect(publishResult.url).toEqual(expect.any(String));
  });
});

function getPublishWorkbookSmokeConfig(): PublishWorkbookSmokeConfig {
  return {
    workbookFilePath: process.env.PUBLISH_WORKBOOK_E2E_FILE?.trim() || defaultWorkbookFilePath,
    workbookName: process.env.PUBLISH_WORKBOOK_E2E_NAME?.trim() || 'Codex Publish Workbook E2E',
    projectId: process.env.PUBLISH_WORKBOOK_E2E_PROJECT_ID?.trim() || defaultProjectId,
  };
}

function getPublishWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
```

- [ ] **Step 5: Run the e2e suite for these three files (requires a live/mock Tableau dataplane per repo e2e conventions — check `tests/e2e/README.md` or existing CI config for required env vars if this fails locally)**

Run: `npx vitest run --config vitest.config.e2e.ts tests/e2e/workbooks/uploadWorkbook.test.ts tests/e2e/workbooks/validateWorkbook.test.ts tests/e2e/workbooks/publishWorkbook.test.ts`
Expected: PASS against a configured Tableau dataplane. If no dataplane is available in this environment, note that explicitly rather than claiming success — this step may need to run in CI or against orchestrator's known Tableau test environment.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/workbooks/uploadWorkbook.test.ts tests/e2e/workbooks/validateWorkbook.test.ts tests/e2e/workbooks/publishWorkbook.test.ts
git commit -m "test: add e2e coverage for upload-workbook and validate-workbook, chain publish-workbook e2e through upload-workbook"
```

---

## Task 7: Full-suite verification and build

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: builds cleanly with no errors.

- [ ] **Step 3: Run `npx tsc` (or repo's typecheck script) one more time on the full tree**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manually verify the full MCP round-trip using the MCP Inspector**

Run: `npm run inspect` (or `npm run inspect:http` depending on transport), then in the Inspector UI: call `request-workbook-upload` → PUT bytes to the returned URL → call `upload-workbook` with the returned `workbookUploadId` → call `validate-workbook` with the same `workbookUploadId` (confirm it returns `status: 'valid'` or `'invalid'` independent of the upload call) → call `publish-workbook` with `upload-workbook`'s `uploadSessionId`/`workbookType`. Confirm both a `.twb` and a `.twbx` file complete this round-trip successfully, with `validate-workbook` on the `.twbx` returning a no-op `{status: 'valid', warnings: []}` without an actual Tableau validate call (check server logs/telemetry to confirm no `validateWorkbookAndUpload` request fires for the twbx case).

This step cannot be scripted as a checkbox-driven test — it is a live manual smoke test to run before considering the plan complete, since it's the only check that exercises all four tools in the real intended client flow together.
