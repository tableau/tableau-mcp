import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../config.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import { getRequestDatasourceUploadTool } from './requestDatasourceUpload.js';
import { MAX_STAGED_DATASOURCE_BYTES } from './stagedDatasourceUpload.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
  mockRequestStagedDatasourceUpload: vi.fn(),
  mockUseRestApi: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: mocks.mockUseRestApi,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
}));

vi.mock('./stagedDatasourceUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedDatasourceUpload.js')>()),
  requestStagedDatasourceUpload: mocks.mockRequestStagedDatasourceUpload,
}));

describe('requestDatasourceUploadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockUseRestApi.mockImplementation(async (opts) => opts.callback({}));
    mocks.mockRequestStagedDatasourceUpload.mockResolvedValue({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with staged upload properties', () => {
    const tool = getRequestDatasourceUploadTool(new WebMcpServer());

    expect(tool.name).toBe('request-datasource-upload');
    expect(tool.description).toContain('staged upload URL');
    expect(tool.paramsSchema).toMatchObject({
      fileName: expect.any(Object),
    });
  });

  it('is enabled when the authoring-tools flag is ON for ChatGPT', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://chatgpt.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('is enabled when the authoring-tools flag is ON for a non-Slack client', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://claude.ai/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled for Slack unless authoring-with-slack is enabled', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'authoring-tools',
    );
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled for Slack when both authoring flags are enabled', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled when the authoring-tools flag is ON and there is no OAuth client id (stdio)', async () => {
    const tool = getRequestDatasourceUploadTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://claude.ai/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('returns a staged upload URL from the OAuth session LUIDs without useRestApi', async () => {
    const result = await getToolResult(
      { fileName: 'Superstore.tds' },
      { config: { ...getConfig(), auth: 'oauth' } },
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith({
      fileName: 'Superstore.tds',
      tenant: { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID },
    });
    expect(mocks.mockUseRestApi).not.toHaveBeenCalled();
  });

  it.each(['pat', 'uat', 'direct-trust'] as const)(
    'signs in and stages under the signed-in identity even when the session has LUIDs for AUTH=%s',
    async (auth) => {
      const signedIn = {
        siteLuid: '11111111-2222-4333-8444-555555555555',
        userLuid: '66666666-7777-4888-9999-000000000000',
      };
      mocks.mockUseRestApi.mockImplementation(async (opts) => {
        opts.setSiteLuid(signedIn.siteLuid);
        opts.setUserLuid(signedIn.userLuid);
        return opts.callback({});
      });
      let siteLuid = MOCK_SITE_LUID;
      let userLuid = MOCK_USER_LUID;

      const result = await getToolResult(
        { fileName: 'Superstore.tds' },
        {
          config: { ...getConfig(), auth },
          getSiteLuid: () => siteLuid,
          getUserLuid: () => userLuid,
          setSiteLuid: (luid: string) => {
            siteLuid = luid;
          },
          setUserLuid: (luid: string) => {
            userLuid = luid;
          },
        },
      );

      expect(result.isError).toBe(false);
      expect(mocks.mockUseRestApi).toHaveBeenCalledTimes(1);
      expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith(
        expect.objectContaining({ tenant: signedIn }),
      );
    },
  );

  it('signs in without API scopes and stages under the signed-in identity when the session has no tenant LUIDs', async () => {
    const signedIn = {
      siteLuid: '11111111-2222-4333-8444-555555555555',
      userLuid: '66666666-7777-4888-9999-000000000000',
    };
    mocks.mockUseRestApi.mockImplementation(async (opts) => {
      opts.setSiteLuid(signedIn.siteLuid);
      opts.setUserLuid(signedIn.userLuid);
      return opts.callback({});
    });
    let siteLuid = '';
    let userLuid = '';

    const result = await getToolResult(
      { fileName: 'Superstore.tds' },
      {
        getSiteLuid: () => siteLuid,
        getUserLuid: () => userLuid,
        setSiteLuid: (luid: string) => {
          siteLuid = luid;
        },
        setUserLuid: (luid: string) => {
          userLuid = luid;
        },
      },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockUseRestApi).toHaveBeenCalledTimes(1);
    expect(mocks.mockUseRestApi.mock.calls[0][0].jwtScopes).toEqual([]);
    expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: signedIn }),
    );
  });

  it('fails closed without staging when the session still has no valid tenant LUIDs after sign-in', async () => {
    const result = await getToolResult({ fileName: 'Superstore.tds' }, { _siteLuid: '' });

    expect(result.isError).toBe(true);
    expect(mocks.mockUseRestApi).toHaveBeenCalledTimes(1);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Unable to determine the signed-in Tableau site and user',
    );
    expect(mocks.mockRequestStagedDatasourceUpload).not.toHaveBeenCalled();
  });

  it('returns a staged upload URL for a .tdsx filename', async () => {
    mocks.mockRequestStagedDatasourceUpload.mockResolvedValue({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });

    const result = await getToolResult({
      fileName: 'Superstore.tdsx',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith({
      fileName: 'Superstore.tdsx',
      tenant: { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID },
    });
  });

  it('returns an error when blob storage is not configured', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(false);

    const result = await getToolResult({ fileName: 'Superstore.tds' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Blob storage provider must be configured before requesting staged data source uploads.',
    );
    expect(mocks.mockRequestStagedDatasourceUpload).not.toHaveBeenCalled();
  });

  it('returns an error for Passthrough auth before creating a signed upload URL', async () => {
    const result = await getToolResult(
      { fileName: 'Superstore.tds' },
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
    expect(mocks.mockRequestStagedDatasourceUpload).not.toHaveBeenCalled();
  });
});

async function getToolResult(
  params: { fileName: string },
  extraOverrides: Parameters<typeof getMockExtra>[0] = {},
): Promise<CallToolResult> {
  const tool = getRequestDatasourceUploadTool(new WebMcpServer());
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
  return getMockRequestHandlerExtra(overrides);
}
