import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookTool } from './validateWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockValidateWorkbookAndUpload: vi.fn(),
  mockResolveWorkbookInput: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
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

// resolveWorkbookInput lives in stagedWorkbookUpload.ts and calls resolveStagedWorkbookUpload
// as an intra-module reference, which a partial vi.mock of that inner function cannot intercept.
// Mock resolveWorkbookInput itself — the helper this tool consumes — so tests isolate
// validate-workbook's own logic. Its file-resolution branches are covered in
// stagedWorkbookUpload.test.ts.
vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
  resolveWorkbookInput: mocks.mockResolveWorkbookInput,
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
    mocks.mockResolveWorkbookInput.mockReset();
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
    mocks.mockResolveWorkbookInput.mockResolvedValue({
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
    mocks.mockResolveWorkbookInput.mockResolvedValue({
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
    mocks.mockResolveWorkbookInput.mockResolvedValue({
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
    mocks.mockResolveWorkbookInput.mockResolvedValue({
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
