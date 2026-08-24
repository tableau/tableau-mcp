import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getUploadWorkbookTool } from './uploadWorkbook.js';

const STAGED_WORKBOOK_UPLOAD_ID = '123e4567-e89b-42d3-a456-426614174000';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockUploadFileInChunks: vi.fn(),
  mockDownloadObjectFromS3IfExists: vi.fn(),
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

// resolveWorkbookInput -> resolveStagedWorkbookUpload are called intra-module, so mocking
// those named exports would not intercept (ESM live bindings). Mock the real S3 boundary the
// staged path bottoms out in instead, letting the genuine resolution logic run under test.
vi.mock('../s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../s3Client.js')>()),
  downloadObjectFromS3IfExists: mocks.mockDownloadObjectFromS3IfExists,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

// WebTool's constructor resolves required API scopes from toolScopeMap. The 'upload-workbook'
// entry is added when the tool is registered (Task 5: scopes.ts), which is out of scope for this
// file. Stub the lookup so the tool can be constructed under test until that registration lands.
vi.mock('../../../server/oauth/scopes.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../server/oauth/scopes.js')>()),
  getRequiredApiScopesForTool: vi.fn(() => []),
}));

// Returns staged bytes only for the S3 key of the requested file type (resolveStagedWorkbookUpload
// probes the .twb key first, then the .twbx key), mirroring how a real staged upload resolves.
function stubStagedUpload(fileType: 'twb' | 'twbx', bytes: Buffer): void {
  mocks.mockDownloadObjectFromS3IfExists.mockImplementation(async ({ key }: { key: string }) =>
    key.endsWith(`workbook.${fileType}`) ? bytes : undefined,
  );
}

describe('uploadWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockUploadFileInChunks.mockReset();
    mocks.mockDownloadObjectFromS3IfExists.mockReset();
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
    const bytes = Buffer.from('<workbook source="new" />');
    stubStagedUpload('twb', bytes);
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');

    const result = await getToolResult({
      workbookUploadId: STAGED_WORKBOOK_UPLOAD_ID,
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
      filename: `${STAGED_WORKBOOK_UPLOAD_ID}.twb`,
      content: bytes,
    });
  });

  it('uploads a .twbx staged workbook via the same chunked-upload path and returns workbookType twbx', async () => {
    const bytes = Buffer.from('PK\x03\x04-fake-zip-bytes');
    stubStagedUpload('twbx', bytes);
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id-2');

    const result = await getToolResult({
      workbookUploadId: STAGED_WORKBOOK_UPLOAD_ID,
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
      filename: `${STAGED_WORKBOOK_UPLOAD_ID}.twbx`,
      content: bytes,
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
    expect(result.content[0].text).toContain(
      'Provide either workbookFilePath or workbookUploadId, not both',
    );
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
  return await callback(
    { workbookUploadId: params.workbookUploadId, workbookFilePath: params.workbookFilePath },
    getMockExtra(options),
  );
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
