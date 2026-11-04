import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
import { MAX_FILE_UPLOAD_CHUNK_BYTES } from '../../../sdks/tableau/methods/publishingMethods.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRequestWorkbookUploadTool } from './requestWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockInitiateClientFileUpload: vi.fn(),
  mockUseRestApi: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: mocks.mockUseRestApi,
}));

const uploadSessionId = '26578:d1b7318519cb453e9e5dca2f77863df3-0:0';
const uploadUrl = `https://tableau.example.com/api/3.29/sites/test-site-id/fileUploads/${uploadSessionId}`;

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('requestWorkbookUploadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag !== 'authoring-with-slack');
    mocks.mockInitiateClientFileUpload.mockResolvedValue({
      uploadSessionId,
      uploadUrl,
      authHeaders: { 'X-Tableau-Auth': 'session-token' },
    });
    mocks.mockUseRestApi.mockImplementation(async (opts) =>
      opts.callback({
        publishingMethods: { initiateClientFileUpload: mocks.mockInitiateClientFileUpload },
        siteId: 'test-site-id',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with direct upload properties', () => {
    const tool = getRequestWorkbookUploadTool(new WebMcpServer());

    expect(tool.name).toBe('request-workbook-upload');
    expect(tool.description).toContain('multipart/mixed');
    expect(tool.paramsSchema).toMatchObject({
      fileName: expect.any(Object),
    });
  });

  it('is enabled for ChatGPT', async () => {
    const tool = getRequestWorkbookUploadTool(
      new WebMcpServer({ clientId: 'https://chatgpt.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled for a non-Slack client', async () => {
    const tool = getRequestWorkbookUploadTool(
      new WebMcpServer({ clientId: 'https://claude.ai/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled for an unknown client', async () => {
    const tool = getRequestWorkbookUploadTool(
      new WebMcpServer({ clientId: 'https://example.com/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled for Slack unless authoring-with-slack is enabled', async () => {
    const tool = getRequestWorkbookUploadTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled for Slack when the authoring-with-slack flag is ON', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    const tool = getRequestWorkbookUploadTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-with-slack');
  });

  it('is enabled when there is no OAuth client id (stdio)', async () => {
    const tool = getRequestWorkbookUploadTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('returns the Tableau upload URL and session headers for a .twbx filename', async () => {
    const result = await getToolResult({
      fileName: 'BoltBikes Workbook.twbx',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      workbookUploadId: `twbx:${uploadSessionId}`,
      uploadUrl,
      requiredHeaders: { 'X-Tableau-Auth': 'session-token' },
      maxChunkBytes: MAX_FILE_UPLOAD_CHUNK_BYTES,
    });
    expect(mocks.mockInitiateClientFileUpload).toHaveBeenCalledWith({ siteId: 'test-site-id' });
    expect(mocks.mockUseRestApi).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:file_uploads:create'],
        keepSignedIn: true,
      }),
    );
  });

  it('tags the upload id with the twb file type', async () => {
    const result = await getToolResult({
      fileName: 'BoltBikes Workbook.twb',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).workbookUploadId).toBe(`twb:${uploadSessionId}`);
  });

  it('returns an error for a non-workbook filename without starting an upload', async () => {
    const result = await getToolResult({
      fileName: 'BoltBikes Workbook.tds',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('.twb or .twbx');
    expect(mocks.mockUseRestApi).not.toHaveBeenCalled();
  });

  it('returns an error for Passthrough auth before creating a signed upload URL', async () => {
    const result = await getToolResult(
      { fileName: 'BoltBikes Workbook.twb' },
      {
        tableauAuthInfo: {
          type: 'Passthrough',
          username: 'viewer@example.com',
          userId: 'test-user-id',
          server: 'https://tableau.example.com',
          siteId: 'test-site-id',
          siteName: 'test-site',
          raw: 'passthrough-token',
        },
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Passthrough authentication');
    expect(mocks.mockUseRestApi).not.toHaveBeenCalled();
  });

  it('logs only the file name because the upload URL and token are produced after execution', async () => {
    const tool = getRequestWorkbookUploadTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        fileName: 'BoltBikes Workbook.twb',
      },
      getMockExtra(),
    );

    expect(logAndExecute.mock.calls[0][0].args).toEqual({
      fileName: 'BoltBikes Workbook.twb',
    });
  });
});

async function getToolResult(
  params: { fileName: string },
  extraOverrides: Parameters<typeof getMockExtra>[0] = {},
): Promise<CallToolResult> {
  const tool = getRequestWorkbookUploadTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      fileName: params.fileName,
    },
    getMockExtra(extraOverrides),
  );
}

function getMockExtra(
  overrides: Partial<ReturnType<typeof getMockRequestHandlerExtra>> = {},
): ReturnType<typeof getMockRequestHandlerExtra> {
  return { ...getMockRequestHandlerExtra(), ...overrides };
}
