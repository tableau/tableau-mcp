import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AxiosError } from 'axios';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { GranteeCapability } from '../../../sdks/tableau/types/permissions.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getPublishWorkbookTool } from './publishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockPublishWorkbook: vi.fn(),
  mockQueryWorkbookPermissions: vi.fn(),
  mockPermissionsSignIn: vi.fn(),
  mockValidateWorkbookAndUpload: vi.fn(),
  mockUploadFileInChunks: vi.fn(),
  mockResolveStagedWorkbookUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetPersonalSpace: vi.fn(),
  useRestApiCalls: [] as Array<{ jwtScopes: unknown }>,
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async (opts) => {
    mocks.useRestApiCalls.push({ jwtScopes: opts.jwtScopes });
    if (opts.jwtScopes.includes('tableau:permissions:read')) {
      await mocks.mockPermissionsSignIn();
    }
    return opts.callback({
      workbooksMethods: {
        validateWorkbookAndUpload: mocks.mockValidateWorkbookAndUpload,
        publishWorkbook: mocks.mockPublishWorkbook,
        queryWorkbookPermissions: mocks.mockQueryWorkbookPermissions,
      },
      publishingMethods: {
        uploadFileInChunks: mocks.mockUploadFileInChunks,
      },
      personalSpaceMethods: {
        getPersonalSpace: mocks.mockGetPersonalSpace,
      },
      siteId: 'test-site-id',
    });
  }),
}));

vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
  resolveStagedWorkbookUpload: mocks.mockResolveStagedWorkbookUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const validArgs = {
  workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
  name: 'My New Workbook',
  projectId: 'target-project-id',
};

const validLocalArgs = {
  workbookFilePath: '/tmp/source-superstore.twb',
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
    mocks.mockQueryWorkbookPermissions.mockReset();
    mocks.mockPermissionsSignIn.mockReset();
    mocks.mockValidateWorkbookAndUpload.mockReset();
    mocks.mockUploadFileInChunks.mockReset();
    mocks.mockResolveStagedWorkbookUpload.mockReset();
    mocks.mockReadFile.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockGetPersonalSpace.mockReset();
    mocks.useRestApiCalls.length = 0;
    mocks.mockReadFile.mockResolvedValue(Buffer.from('<workbook source="local" />'));
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'authoring-tools' || flag === 'data-apps',
    );
    // Benign default so project-publish tests that don't assert on permissions stay green.
    mocks.mockQueryWorkbookPermissions.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('publish-workbook');
    expect(await Provider.from(tool.description)).toContain('Publishes a TWB or TWBX workbook');
    expect(annotations.destructiveHint).toBe(true);
    expect(paramsSchema.safeParse({ ...validArgs, name: '' }).success).toBe(false);
    expect(await Provider.from(tool.description)).toContain('Personal Space');
    expect(paramsSchema.safeParse({ ...validArgs, personalSpace: true }).success).toBe(true);
    expect(paramsSchema.safeParse({ ...validArgs, personalSpace: false }).success).toBe(true);
    expect(
      paramsSchema.safeParse({ ...validArgs, personalSpace: 'personal-space-luid' }).success,
    ).toBe(false);
    expect(paramsSchema.parse(validArgs).personalSpace).toBe(true);
  });

  it.each([false, true])(
    'advertises Personal Space and permission fields only when data-apps is %s',
    async (enabled) => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (flag: string) =>
        flag === 'data-apps' ? enabled : true,
      );
      const { McpServer } = await vi.importActual<
        typeof import('@modelcontextprotocol/sdk/server/mcp.js')
      >('@modelcontextprotocol/sdk/server/mcp.js');
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      const tool = getPublishWorkbookTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      server.registerTool(
        tool.name,
        {
          description: await Provider.from(tool.description),
          inputSchema: schema,
        },
        async () => ({ content: [] }),
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const { tools } = await client.listTools();
        const listed = tools.find(({ name }) => name === 'publish-workbook');
        expect(listed?.inputSchema.properties).toHaveProperty('projectId');
        if (enabled) {
          expect(listed?.inputSchema.properties).toHaveProperty('personalSpace');
          expect(listed?.inputSchema.required).not.toContain('projectId');
          expect(listed?.description).toContain('personalSpace');
          expect(listed?.description).toContain('workbook permission rules');
          expect(listed?.description).toContain('permissionsNote');
          expect(listed?.description).not.toMatch(
            /permissionsMessage|PDS reminder|Full Data Query/,
          );
        } else {
          expect(listed?.inputSchema.properties).not.toHaveProperty('personalSpace');
          expect(listed?.inputSchema.required).toContain('projectId');
          expect(listed?.description).not.toMatch(
            /personal.?space|data app|permissions|PDS|base response/i,
          );
          expect(schema.safeParse({ ...validArgs, personalSpace: true }).success).toBe(false);
        }
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it('rejects a stale schema call without projectId after data-apps is disabled before API or file access', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const schema = await Provider.from(tool.paramsSchema);
    const args = schema.parse({
      name: validArgs.name,
      workbookFilePath: '/tmp/demo.twbx',
      personalSpace: true,
    });
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag: string) => flag !== 'data-apps');
    const result = await (await Provider.from(tool.callback))(args, getMockExtra({}));

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('projectId is required to publish a workbook.'),
      }),
    ]);
    expect(mocks.useRestApiCalls).toHaveLength(0);
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('keeps project publishing available when data-apps is disabled', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag: string) => flag !== 'data-apps');
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({ uploadId: 'validated-upload-id' });
    const tool = getPublishWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
    expect((await Provider.from(tool.paramsSchema)).safeParse(validArgs).success).toBe(true);
    const result = await getToolResult(validArgs);
    expect(result.isError).toBe(false);
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: validArgs.projectId }),
    );

    // A defaulted personalSpace leaking through a stale schema must not block a projectId publish.
    mocks.mockPublishWorkbook.mockClear();
    const staleResult = await getToolResult({ ...validArgs, personalSpace: true });
    expect(staleResult.isError).toBe(false);
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: validArgs.projectId }),
    );
  });

  it('is enabled when the authoring-tools flag is ON for ChatGPT', async () => {
    const tool = getPublishWorkbookTool(
      new WebMcpServer({ clientId: 'https://chatgpt.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('is enabled when the authoring-tools flag is ON for a non-Slack client', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled when the authoring-tools flag is ON for an unknown client', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer({ clientId: 'https://example.com/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools flag is ON for Slack', async () => {
    const tool = getPublishWorkbookTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when the authoring-tools flag is ON and there is no OAuth client id (stdio)', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getPublishWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('validates, publishes to the requested project, and returns the published workbook', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
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
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
    expect(response.warnings).toEqual([
      {
        severity: 'WARNING',
        message: 'Unknown map source is used',
        line: 245,
        column: 18,
        elementName: 'map',
      },
    ]);

    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="new" />'),
    });
    expect(mocks.mockResolveStagedWorkbookUpload).toHaveBeenCalledWith({
      workbookUploadId: validArgs.workbookUploadId,
      config: expect.objectContaining({ bucket: 'tableau-workbooks' }),
    });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'validated-upload-id',
      name: 'My New Workbook',
      workbookType: 'twb',
      projectId: 'target-project-id',
      overwrite: false,
    });
  });

  it('uploads and publishes a TWBX file without a separate validation step', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twbx',
      bytes: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);

    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twbx',
      content: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'chunked-upload-session-id',
      name: 'My New Workbook',
      workbookType: 'twbx',
      projectId: 'target-project-id',
      overwrite: false,
    });
  });

  it('returns an error when Tableau rejects an invalid TWBX workbook during publish', async () => {
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twbx',
      bytes: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');
    mocks.mockPublishWorkbook.mockRejectedValue(
      new Error('Tableau publishWorkbook request failed with status 400: bad workbook'),
    );

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('bad workbook');
  });

  it('uploads and publishes a local TWBX workbook file path without a separate validation step', async () => {
    mocks.mockReadFile.mockResolvedValue(Buffer.from('PK\x03\x04-fake-zip-bytes'));
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    const result = await getToolResult(
      { ...validLocalArgs, workbookFilePath: '/tmp/source-superstore.twbx' },
      { bucketS3Enabled: false },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.twbx');
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twbx',
      content: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ workbookType: 'twbx' }),
    );
  });

  it('defaults overwrite to false when publishing', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    await getToolResult(validArgs);

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it('returns an error without overwriting when Tableau rejects a duplicate workbook name', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
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
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('resolves the staged workbookUploadId before validation', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
    const workbookUploadId = '123e4567-e89b-42d3-a456-426614174000';

    await getToolResult({
      workbookUploadId,
      name: 'My New Workbook',
      projectId: 'target-project-id',
    });

    expect(mocks.mockResolveStagedWorkbookUpload).toHaveBeenCalledWith({
      workbookUploadId,
      config: expect.objectContaining({ bucket: 'tableau-workbooks' }),
    });
    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="new" />'),
    });
  });

  it('validates and publishes a local workbook file path', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });

    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: false });

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.twb');
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="local" />'),
    });
  });

  it('rejects local workbook file paths when staged S3 uploads are configured', async () => {
    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'workbookFilePath is only supported when staged S3 uploads are not configured',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an args-validation error when local workbook path is neither twb nor twbx', async () => {
    const result = await getToolResult(
      {
        ...validLocalArgs,
        workbookFilePath: '/tmp/source-superstore.xml',
      },
      { bucketS3Enabled: false },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('workbookFilePath must point to a .twb or .twbx file');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an args-validation error when local workbook file is empty', async () => {
    mocks.mockReadFile.mockResolvedValue(Buffer.from(''));

    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: false });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('workbookFilePath must not point to an empty');
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an error when both local path and staged upload id are provided', async () => {
    const result = await getToolResult({
      ...validLocalArgs,
      workbookUploadId: validArgs.workbookUploadId,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Provide either workbookFilePath or workbookUploadId, not both',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an error when neither local path nor staged upload id is provided', async () => {
    const result = await getToolResult({ name: validArgs.name, projectId: validArgs.projectId });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Either workbookFilePath or workbookUploadId');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns validation errors and does not publish when the workbook is invalid', async () => {
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

    const result = await getToolResult(validArgs);

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
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('returns an error before validation when the requested project is outside bounded context', async () => {
    const result = await getToolResult(validArgs, {
      boundedProjectIds: new Set(['different-project-id']),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed by this MCP server');
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('rejects personalSpace false without projectId before any API or file access', async () => {
    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
      personalSpace: false,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('projectId is required');
    expect(mocks.useRestApiCalls).toHaveLength(0);
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('lets projectId win over personalSpace true', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({ uploadId: 'validated-upload-id' });

    const result = await getToolResult({ ...validArgs, personalSpace: true });

    expect(result.isError).toBe(false);
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'target-project-id' }),
    );
    expect(mocks.mockPublishWorkbook.mock.calls[0][0]).not.toHaveProperty('location');
  });

  it('publishes to the project when personalSpace is explicitly false', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });

    const result = await getToolResult({ ...validArgs, personalSpace: false });

    expect(result.isError).toBe(false);
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'target-project-id' }),
    );
    expect(mocks.mockPublishWorkbook.mock.calls[0][0]).not.toHaveProperty('location');
  });

  it('publishes to the caller Personal Space when projectId and personalSpace are both omitted', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: undefined,
      location: { id: 'personal-space-luid', type: 'PersonalSpace' },
    });

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.location).toEqual({ id: 'personal-space-luid', type: 'PersonalSpace' });

    expect(mocks.mockGetPersonalSpace).toHaveBeenCalledWith({ siteId: 'test-site-id' });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'validated-upload-id',
      name: 'My New Workbook',
      workbookType: 'twb',
      location: 'personal-space-luid',
      overwrite: false,
    });
    // Personal Space path must not pass projectId to the SDK.
    expect(mocks.mockPublishWorkbook.mock.calls[0][0]).not.toHaveProperty('projectId');
  });

  it('does not run the bounded-context check on the explicit Personal Space path', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: undefined,
      location: { id: 'personal-space-luid', type: 'PersonalSpace' },
    });

    // A bounded context that would reject the personal-space luid if it were checked.
    const result = await getToolResult(
      { workbookUploadId: validArgs.workbookUploadId, name: validArgs.name, personalSpace: true },
      { boundedProjectIds: new Set(['only-this-project']) },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockPublishWorkbook).toHaveBeenCalled();
  });

  it('errors without publishing when Personal Space is read-only', async () => {
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: true,
    });

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('read-only');
    expect(result.content[0].text).toContain('pass projectId');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('errors without publishing when Personal Space cannot be resolved', async () => {
    mocks.mockGetPersonalSpace.mockRejectedValue(new Error('404 personalSpace not found'));

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
      personalSpace: true,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Could not resolve your Personal Space');
    expect(result.content[0].text).toContain('404 personalSpace not found');
    expect(result.content[0].text).toContain('pass projectId');
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('never resolves Personal Space when an explicit projectId is provided', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });

    await getToolResult(validArgs);

    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'target-project-id' }),
    );
  });

  it('requests only the base publish scopes for Personal Space or when data-apps is disabled', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: undefined,
      location: { id: 'personal-space-luid', type: 'PersonalSpace' },
    });

    await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
      personalSpace: true,
    });
    expect(mocks.useRestApiCalls.at(-1)?.jwtScopes).toEqual([
      'tableau:workbooks:create',
      'tableau:file_uploads:create',
      'tableau:projects:read',
    ]);

    mocks.useRestApiCalls.length = 0;
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'authoring-tools');
    mocks.mockPublishWorkbook.mockResolvedValue(mockWorkbook);
    await getToolResult(validArgs);
    expect(mocks.useRestApiCalls.at(-1)?.jwtScopes).toEqual([
      'tableau:workbooks:create',
      'tableau:file_uploads:create',
      'tableau:projects:read',
    ]);
  });

  it.each([undefined, true, false])(
    'discloses project permissions when personalSpace is %s',
    async (personalSpace) => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
        timestamp: '2026-06-10T14:32:18.456Z',
        uploadId: 'validated-upload-id',
      });
      mocks.mockPublishWorkbook.mockResolvedValue({
        ...mockWorkbook,
        project: { id: 'target-project-id', name: 'Marketing Analytics' },
      });
      const granteeCapabilities = [
        {
          group: { id: 'group-1', name: 'Analysts' },
          capabilities: { capability: [{ name: 'Read', mode: 'Allow' }] },
        },
      ];
      mocks.mockQueryWorkbookPermissions.mockResolvedValue(granteeCapabilities);

      const result = await getToolResult({ ...validArgs, personalSpace });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('published');
      expect(response.permissions).toEqual(granteeCapabilities);
      expect(response.permissionsNote).toBeUndefined();
      expect(mocks.mockQueryWorkbookPermissions).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        workbookId: mockWorkbook.id,
      });
      expect(mocks.useRestApiCalls).toEqual([
        {
          jwtScopes: [
            'tableau:workbooks:create',
            'tableau:file_uploads:create',
            'tableau:projects:read',
          ],
        },
        { jwtScopes: ['tableau:permissions:read'] },
      ]);
      expect(mocks.mockPublishWorkbook).toHaveBeenCalledBefore(mocks.mockPermissionsSignIn);
    },
  );

  describe('raw permissions in the tool response', () => {
    const allowed = ['Read', 'Connect', 'VizqlDataApiAccess'].map((name) => ({
      name,
      mode: 'Allow',
    }));
    const group = (capability = allowed): GranteeCapability => ({
      group: { id: 'group-1' },
      capabilities: { capability },
    });
    const user: GranteeCapability = {
      user: { id: 'user-1' },
      capabilities: { capability: allowed },
    };

    it.each<{ label: string; rules: GranteeCapability[] }>([
      { label: 'all required grants on a group', rules: [group()] },
      { label: 'all required grants on multiple principals', rules: [group(), user] },
      { label: 'empty rules', rules: [] },
      {
        label: 'missing capabilities object',
        rules: [{ group: { id: 'group-1' } }],
      },
      {
        label: 'missing capability array',
        rules: [{ user: { id: 'user-1' }, capabilities: {} }],
      },
      {
        label: 'mixed complete and incomplete rules',
        rules: [user, group(allowed.slice(0, 2))],
      },
      {
        label: 'AI Access does not replace API Access',
        rules: [group([...allowed.slice(0, 2), { name: 'AIAccess', mode: 'Allow' }])],
      },
      {
        label: 'conflicting entries',
        rules: [group([...allowed, { name: 'Read', mode: 'Deny' }])],
      },
      ...['Read', 'Connect', 'VizqlDataApiAccess'].flatMap((name) =>
        ['Deny', 'Unspecified', 'missing'].map((mode) => ({
          label: `${name} ${mode}`,
          rules: [
            group(
              mode === 'missing'
                ? allowed.filter((entry) => entry.name !== name)
                : allowed.map((entry) => (entry.name === name ? { name, mode } : entry)),
            ),
          ],
        })),
      ),
    ])(
      'preserves $label without interpretation in text and structuredContent',
      async ({ rules }) => {
        mocks.mockValidateWorkbookAndUpload.mockResolvedValue({ uploadId: 'validated-upload-id' });
        mocks.mockQueryWorkbookPermissions.mockResolvedValue(rules);
        const publishedName = 'Published workbook name';
        mocks.mockPublishWorkbook.mockResolvedValue({ ...mockWorkbook, name: publishedName });

        const result = await getToolResult(validArgs);

        expect(result.isError).toBe(false);
        invariant(result.content[0].type === 'text');
        const response = JSON.parse(result.content[0].text);
        expect(result.structuredContent).toEqual(response);
        expect(response.permissions).toEqual(rules);
        expect(response).not.toHaveProperty('permissionsMessage');
        expect(mocks.mockQueryWorkbookPermissions).toHaveBeenCalledOnce();
      },
    );
  });

  it('skips permissions and keeps publishing available when data-apps is disabled', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'authoring-tools');
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    expect(await Provider.from(getPublishWorkbookTool(new WebMcpServer()).disabled)).toBe(false);

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response).not.toHaveProperty('permissions');
    expect(response).not.toHaveProperty('permissionsNote');
    expect(response).not.toHaveProperty('permissionsMessage');
    expect(mocks.mockQueryWorkbookPermissions).not.toHaveBeenCalled();
    expect(mocks.mockPermissionsSignIn).not.toHaveBeenCalled();
    expect(mocks.useRestApiCalls).toHaveLength(1);
  });

  it('skips the optional read if data-apps is disabled while publishing', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({ uploadId: 'validated-upload-id' });
    mocks.mockPublishWorkbook.mockImplementation(async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'authoring-tools');
      return mockWorkbook;
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ status: 'published' });
    expect(result.structuredContent).not.toHaveProperty('permissions');
    expect(result.structuredContent).not.toHaveProperty('permissionsNote');
    expect(result.structuredContent).not.toHaveProperty('permissionsMessage');
    expect(mocks.mockQueryWorkbookPermissions).not.toHaveBeenCalled();
    expect(mocks.mockPermissionsSignIn).not.toHaveBeenCalled();
    expect(mocks.useRestApiCalls).toHaveLength(1);
  });

  it.each([
    { granted: false, enforceScopes: true, advertiseApiScopes: true, expected: false },
    { granted: true, enforceScopes: true, advertiseApiScopes: true, expected: true },
    { granted: false, enforceScopes: false, advertiseApiScopes: true, expected: true },
    { granted: false, enforceScopes: true, advertiseApiScopes: false, expected: true },
  ])(
    'respects optional OAuth scope consent: $granted, $enforceScopes, $advertiseApiScopes',
    async ({ granted, enforceScopes, advertiseApiScopes, expected }) => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
        timestamp: '2026-06-10T14:32:18.456Z',
        uploadId: 'validated-upload-id',
      });
      const extra = getMockExtra();
      extra.config.oauth = { ...extra.config.oauth, enforceScopes, advertiseApiScopes };
      extra.authInfo = {
        token: 'test-token',
        clientId: 'test-client',
        scopes: granted ? ['tableau:permissions:read'] : [],
      };
      const callback = await Provider.from(getPublishWorkbookTool(new WebMcpServer()).callback);

      const result = await callback(
        { ...validArgs, workbookFilePath: undefined, overwrite: false },
        extra,
      );

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('published');
      expect(mocks.mockPermissionsSignIn).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(mocks.mockQueryWorkbookPermissions).toHaveBeenCalledTimes(expected ? 1 : 0);
      if (expected) {
        expect(response.permissions).toEqual([]);
        expect(response.permissionsNote).toBeUndefined();
      } else {
        expect(response.permissions).toBeUndefined();
        expect(response.permissionsNote).toContain('could not be retrieved');
        expect(response).not.toHaveProperty('permissionsMessage');
      }
    },
  );

  it('does not fetch permissions for a Personal Space publish', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: undefined,
      location: { id: 'personal-space-luid', type: 'PersonalSpace' },
    });

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.permissions).toBeUndefined();
    expect(response.permissionsNote).toBeUndefined();
    expect(response).not.toHaveProperty('permissionsMessage');
    expect(mocks.mockQueryWorkbookPermissions).not.toHaveBeenCalled();
    expect(mocks.mockPermissionsSignIn).not.toHaveBeenCalled();
    expect(mocks.useRestApiCalls).toHaveLength(1);
  });

  it('still returns the published workbook when the permissions fetch fails', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
    mocks.mockQueryWorkbookPermissions.mockRejectedValue(new Error('403 Forbidden'));

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.permissions).toBeUndefined();
    expect(response.permissionsNote).toContain('could not be retrieved');
    expect(response).not.toHaveProperty('permissionsMessage');
  });

  it.each(['authentication', 'feature lookup'])(
    'still returns the published workbook when optional permissions %s fails',
    async (failure) => {
      mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
        timestamp: '2026-06-10T14:32:18.456Z',
        uploadId: 'validated-upload-id',
      });
      mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => {
        if (
          flag === 'data-apps' &&
          failure === 'feature lookup' &&
          mocks.mockPublishWorkbook.mock.calls.length > 0
        ) {
          throw new Error('Feature service unavailable');
        }
        return true;
      });
      if (failure === 'authentication') {
        mocks.mockPermissionsSignIn.mockRejectedValue(new Error('Scope not granted'));
      }

      const result = await getToolResult(validArgs);

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('published');
      expect(response.data.id).toBe(mockWorkbook.id);
      expect(response.permissions).toBeUndefined();
      expect(response.permissionsNote).toContain('could not be retrieved');
      expect(response).not.toHaveProperty('permissionsMessage');
      expect(mocks.mockPublishWorkbook).toHaveBeenCalledOnce();
      expect(mocks.mockQueryWorkbookPermissions).not.toHaveBeenCalled();
    },
  );

  it('errors when a Personal Space publish silently lands in a project instead', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
      location: { id: 'default-project-id', type: 'Project' },
    });

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
      personalSpace: true,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('personal space');
  });

  it('maps the site-disabled personal-space publish error to a clean message', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
    });
    const axiosError = new AxiosError('Request failed with status code 400');
    axiosError.response = {
      status: 400,
      data: {
        error: {
          code: '400000',
          detail:
            'Payload is either malformed or incomplete. (0x5CE10192 : Publishing a workbook directly to personal space is not enabled for this site.)',
        },
      },
    } as AxiosError['response'];
    mocks.mockPublishWorkbook.mockRejectedValue(axiosError);

    const result = await getToolResult({
      workbookUploadId: validArgs.workbookUploadId,
      name: validArgs.name,
      personalSpace: true,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not enabled for this Tableau site');
  });

  it('returns an error and does not publish when Tableau does not return an upload id', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not return an uploadId');
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
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('redacts staged workbookUploadId details passed to shared logging', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: undefined,
        name: validArgs.name,
        projectId: validArgs.projectId,
        personalSpace: undefined,
        overwrite: false,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookUploadId: '<redacted>',
      workbookFilePath: undefined,
      name: validArgs.name,
      projectId: validArgs.projectId,
      personalSpace: undefined,
      overwrite: false,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain('123e4567-e89b-42d3-a456-426614174000');
  });
});

async function getToolResult(
  params: {
    workbookUploadId?: string;
    workbookFilePath?: string;
    name: string;
    projectId?: string;
    personalSpace?: boolean;
    overwrite?: boolean;
  },
  options: { boundedProjectIds?: Set<string> | null; bucketS3Enabled?: boolean } = {},
): Promise<CallToolResult> {
  const tool = getPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      workbookUploadId: params.workbookUploadId,
      workbookFilePath: params.workbookFilePath,
      name: params.name,
      projectId: params.projectId,
      personalSpace: params.personalSpace,
      overwrite: params.overwrite ?? false,
    },
    getMockExtra(options),
  );
}

function getMockExtra({
  boundedProjectIds = null,
  bucketS3Enabled = true,
}: {
  boundedProjectIds?: Set<string> | null;
  bucketS3Enabled?: boolean;
} = {}): ReturnType<typeof getMockRequestHandlerExtra> {
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
