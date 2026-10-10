import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AxiosError } from 'axios';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getPublishDatasourceTool } from './publishDatasource.js';

const mocks = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockCreateReadStream: vi.fn(),
  mockStreamStagedDatasourceUpload: vi.fn(),
  mockListDatasources: vi.fn(),
  mockUploadStreamInChunks: vi.fn(),
  mockPublishDatasourceAsJob: vi.fn(),
  mockGetJob: vi.fn(),
  mockQueryDatasourcePermissions: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  sessionEvents: [] as string[],
}));

vi.mock('fs/promises', () => ({ stat: mocks.mockStat }));
vi.mock('fs', () => ({ createReadStream: mocks.mockCreateReadStream }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async (opts) => {
    const session = opts.jwtScopes.includes('tableau:permissions:read') ? 'permissions' : 'publish';
    mocks.sessionEvents.push(`open:${session}`);
    try {
      return await opts.callback({
        datasourcesMethods: {
          listDatasources: mocks.mockListDatasources,
          publishDatasourceAsJob: mocks.mockPublishDatasourceAsJob,
          queryDatasourcePermissions: mocks.mockQueryDatasourcePermissions,
        },
        publishingMethods: { uploadStreamInChunks: mocks.mockUploadStreamInChunks },
        jobsMethods: { getJob: mocks.mockGetJob },
        siteId: 'test-site-id',
      });
    } finally {
      mocks.sessionEvents.push(`close:${session}`);
    }
  }),
}));

vi.mock('./stagedDatasourceUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedDatasourceUpload.js')>()),
  streamStagedDatasourceUpload: mocks.mockStreamStagedDatasourceUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const UPLOAD_ID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT = { id: 'target-project-id', name: 'Data Apps' };
const publishedDatasource = {
  id: 'new-ds-luid',
  name: 'WAM',
  contentUrl: 'WAM',
  project: PROJECT,
  webpageUrl: 'https://tableau.example.com/#/datasources/1',
};
const stagedArgs = { datasourceUploadId: UPLOAD_ID, name: 'WAM', projectId: PROJECT.id };
const localArgs = { datasourceFilePath: '/tmp/wam.tdsx', name: 'WAM', projectId: PROJECT.id };

type Args = {
  datasourceUploadId?: string;
  datasourceFilePath?: string;
  name: string;
  projectId: string;
  description?: string;
  overwrite?: boolean;
};

type ExtraOptions = {
  boundedProjectIds?: Set<string> | null;
  boundedDatasourceIds?: Set<string> | null;
  bucketS3Enabled?: boolean;
  jobTimeoutSeconds?: number;
};

describe('publishDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.sessionEvents.length = 0;
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag !== 'authoring-with-slack');
    mocks.mockStat.mockResolvedValue({ size: 10 });
    mocks.mockCreateReadStream.mockReturnValue([Buffer.from('local-bytes')]);
    mocks.mockStreamStagedDatasourceUpload.mockResolvedValue({
      fileName: 'datasource.tdsx',
      fileType: 'tdsx',
      stream: [Buffer.from('staged-bytes')],
    });
    mocks.mockListDatasources.mockReset();
    mocks.mockGetJob.mockReset();
    // First lookup (collision check) finds nothing; second (post-publish) finds the new one.
    mocks.mockListDatasources
      .mockResolvedValueOnce({ datasources: [] })
      .mockResolvedValue({ datasources: [publishedDatasource] });
    mocks.mockUploadStreamInChunks.mockResolvedValue({
      uploadSessionId: 'upload-session',
      totalBytes: 12,
    });
    mocks.mockPublishDatasourceAsJob.mockResolvedValue({ jobId: 'job-1' });
    mocks.mockGetJob.mockResolvedValue({ id: 'job-1', finishCode: 0 });
    mocks.mockQueryDatasourcePermissions.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with the expected properties', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = z.object(await Provider.from(tool.paramsSchema));

    expect(tool.name).toBe('publish-datasource');
    expect(await Provider.from(tool.description)).toContain('Publishes a TDSX or HYPER');
    expect(annotations.destructiveHint).toBe(true);
    expect(paramsSchema.safeParse({ ...stagedArgs, projectId: undefined }).success).toBe(false);
    expect(paramsSchema.parse(stagedArgs).overwrite).toBe(false);
  });

  it('is disabled when the authoring-tools flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled for Slack clients', async () => {
    const tool = getPublishDatasourceTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when the authoring-tools flag is ON for a non-Slack client', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('publishes a staged upload and returns the published data source', async () => {
    const result = await getToolResult({ ...stagedArgs, description: 'Wins and losses' });

    expect(result.isError).toBe(false);
    expect(getJson(result)).toEqual({
      status: 'published',
      datasource: publishedDatasource,
      server: expect.any(String),
      siteContentUrl: expect.any(String),
      overwritten: false,
      permissions: [],
    });
    expect(mocks.mockStreamStagedDatasourceUpload).toHaveBeenCalledWith({
      datasourceUploadId: UPLOAD_ID,
      config: expect.objectContaining({ enabled: true }),
    });
    expect(mocks.mockUploadStreamInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'datasource.tdsx',
      stream: expect.anything(),
    });
    expect(mocks.mockPublishDatasourceAsJob).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'upload-session',
      datasourceType: 'tdsx',
      name: 'WAM',
      projectId: PROJECT.id,
      description: 'Wins and losses',
      overwrite: false,
    });
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:WAM',
      pageSize: 1000,
    });
    expect(mocks.sessionEvents).toEqual([
      'open:publish',
      'close:publish',
      'open:permissions',
      'close:permissions',
    ]);
  });

  it('streams a local .hyper file when S3 staging is not configured', async () => {
    const result = await getToolResult(
      { ...localArgs, datasourceFilePath: '/tmp/orders.hyper' },
      { bucketS3Enabled: false },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockCreateReadStream).toHaveBeenCalledWith('/tmp/orders.hyper');
    expect(mocks.mockUploadStreamInChunks).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'orders.hyper' }),
    );
    expect(mocks.mockPublishDatasourceAsJob).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceType: 'hyper' }),
    );
    expect(mocks.mockStreamStagedDatasourceUpload).not.toHaveBeenCalled();
  });

  describe('input validation', () => {
    it.each([
      [
        'both inputs are provided',
        { ...stagedArgs, datasourceFilePath: '/tmp/wam.tdsx' },
        false,
        'not both',
      ],
      [
        'neither input is provided',
        { name: 'WAM', projectId: PROJECT.id },
        false,
        'Either datasourceFilePath or datasourceUploadId must be provided',
      ],
      [
        'the local file has the wrong extension',
        { ...localArgs, datasourceFilePath: '/tmp/wam.tds' },
        false,
        'must point to a .tdsx or .hyper file',
      ],
      [
        'a local path is given while S3 staging is enabled',
        localArgs,
        true,
        'Call request-datasource-upload first',
      ],
      [
        'a staged upload id is given while S3 staging is disabled',
        stagedArgs,
        false,
        'MCP_S3_BUCKET must be configured',
      ],
    ])('rejects when %s', async (_, args, bucketS3Enabled, message) => {
      const result = await getToolResult(args, { bucketS3Enabled });

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain(message);
      expect(mocks.mockUploadStreamInChunks).not.toHaveBeenCalled();
      expect(mocks.mockPublishDatasourceAsJob).not.toHaveBeenCalled();
    });

    it('rejects an empty local file', async () => {
      mocks.mockStat.mockResolvedValue({ size: 0 });

      const result = await getToolResult(localArgs, { bucketS3Enabled: false });

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('empty data source file');
      expect(mocks.mockUploadStreamInChunks).not.toHaveBeenCalled();
    });

    it('rejects a name containing a comma', async () => {
      const result = await getToolResult({ ...stagedArgs, name: 'Sales, 2026' });

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('commas');
      expect(mocks.mockListDatasources).not.toHaveBeenCalled();
    });

    it('surfaces a missing staged upload error', async () => {
      mocks.mockStreamStagedDatasourceUpload.mockRejectedValue(
        new Error('Data source upload not found.'),
      );

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(mocks.mockPublishDatasourceAsJob).not.toHaveBeenCalled();
    });
  });

  describe('bounded context', () => {
    it('rejects a project outside the bounded context before any REST call', async () => {
      const result = await getToolResult(stagedArgs, {
        boundedProjectIds: new Set(['other-project-id']),
      });

      expect(result.isError).toBe(true);
      expect(mocks.sessionEvents).toEqual([]);
    });

    it('adds boundedContextNote when the new LUID is not in the allowed data sources', async () => {
      const result = await getToolResult(stagedArgs, {
        boundedDatasourceIds: new Set(['some-other-ds']),
      });

      expect(result.isError).toBe(false);
      expect(getJson(result).boundedContextNote).toContain('new-ds-luid');
    });

    it('omits boundedContextNote when data sources are not restricted', async () => {
      const result = await getToolResult(stagedArgs);

      expect(getJson(result)).not.toHaveProperty('boundedContextNote');
    });
  });

  describe('overwrite', () => {
    beforeEach(() => {
      mocks.mockListDatasources.mockReset();
      mocks.mockListDatasources.mockResolvedValue({
        datasources: [{ ...publishedDatasource, id: 'existing-ds-luid' }],
      });
    });

    it('fails before uploading when the name exists and overwrite is false', async () => {
      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('pass overwrite: true or choose another name');
      expect(mocks.mockStreamStagedDatasourceUpload).not.toHaveBeenCalled();
      expect(mocks.mockUploadStreamInChunks).not.toHaveBeenCalled();
    });

    it('ignores same-name data sources in other projects and wildcard matches', async () => {
      mocks.mockListDatasources.mockReset();
      mocks.mockListDatasources
        .mockResolvedValueOnce({
          datasources: [
            { ...publishedDatasource, id: 'elsewhere', project: { id: 'p2', name: 'Other' } },
            { ...publishedDatasource, id: 'wildcard', name: 'WAM 2' },
          ],
        })
        .mockResolvedValue({ datasources: [publishedDatasource] });

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(false);
      expect(getJson(result)).toMatchObject({ status: 'published', overwritten: false });
    });

    it('reports overwritten: true when replacing an existing data source', async () => {
      const result = await getToolResult({ ...stagedArgs, overwrite: true });

      expect(result.isError).toBe(false);
      expect(getJson(result)).toMatchObject({
        status: 'published',
        overwritten: true,
        datasource: { id: 'existing-ds-luid' },
      });
      expect(mocks.mockPublishDatasourceAsJob).toHaveBeenCalledWith(
        expect.objectContaining({ overwrite: true }),
      );
    });
  });

  describe('publish errors', () => {
    it('maps 403007 to the overwrite hint', async () => {
      mocks.mockPublishDatasourceAsJob.mockRejectedValue(
        tableauError(403, { code: '403007', summary: 'Forbidden' }),
      );

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('pass overwrite: true or choose another name');
    });

    it('passes through other 403s with a list-projects hint', async () => {
      mocks.mockPublishDatasourceAsJob.mockRejectedValue(
        tableauError(403, {
          code: '403004',
          summary: 'Forbidden',
          detail: 'User lacks Write permission on the project.',
        }),
      );

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('User lacks Write permission on the project.');
      expect(getText(result)).toContain('list-projects');
    });

    it('rejects an upload that turns out to be empty', async () => {
      mocks.mockUploadStreamInChunks.mockResolvedValue({
        uploadSessionId: 'upload-session',
        totalBytes: 0,
      });

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('must not be empty');
      expect(mocks.mockPublishDatasourceAsJob).not.toHaveBeenCalled();
    });
  });

  describe('job polling', () => {
    it('polls with backoff until the job succeeds, then looks up the data source', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      mocks.mockGetJob
        .mockResolvedValueOnce({ id: 'job-1', progress: 10 })
        .mockResolvedValueOnce({ id: 'job-1', progress: 50 })
        .mockResolvedValue({ id: 'job-1', finishCode: 0 });

      const pending = getToolResult(stagedArgs);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.isError).toBe(false);
      expect(getJson(result).status).toBe('published');
      expect(mocks.mockGetJob).toHaveBeenCalledTimes(3);
      expect(mocks.mockGetJob).toHaveBeenCalledWith({ siteId: 'test-site-id', jobId: 'job-1' });
      expect(mocks.mockListDatasources).toHaveBeenCalledTimes(2);
    });

    it('returns failed with sanitized job notes', async () => {
      mocks.mockGetJob.mockResolvedValue({
        id: 'job-1',
        finishCode: 1,
        statusNotes: { statusNote: [{ type: 'ErrorInfo', text: 'Bad extract.\u0007' }] },
      });

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(false);
      expect(getJson(result)).toEqual({
        status: 'failed',
        jobId: 'job-1',
        message: 'Bad extract.',
      });
      expect(mocks.sessionEvents).not.toContain('open:permissions');
    });

    it('lists the known causes when a failed job has no notes', async () => {
      mocks.mockGetJob.mockResolvedValue({ id: 'job-1', finishCode: 1 });

      const result = await getToolResult(stagedArgs);

      expect(getJson(result)).toMatchObject({ status: 'failed', jobId: 'job-1' });
      expect(getJson(result).message).toContain('more than one table');
      expect(getJson(result).message).toContain('malformed .tds');
      expect(getJson(result).message).toContain('extract is missing');
    });

    it('returns pending with the jobId when the job outlasts the timeout', async () => {
      mocks.mockGetJob.mockResolvedValue({ id: 'job-1', progress: 20 });

      const result = await getToolResult(stagedArgs, { jobTimeoutSeconds: 0 });

      expect(result.isError).toBe(false);
      expect(getJson(result)).toEqual({
        status: 'pending',
        jobId: 'job-1',
        name: 'WAM',
        projectId: PROJECT.id,
      });
      expect(mocks.mockListDatasources).toHaveBeenCalledTimes(1);
    });

    it('errors when the job succeeds but the data source cannot be found', async () => {
      mocks.mockListDatasources.mockReset();
      mocks.mockListDatasources.mockResolvedValue({ datasources: [] });

      const result = await getToolResult(stagedArgs);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('job-1');
      expect(getText(result)).toContain('list-datasources');
    });
  });

  it('still succeeds with permissionsNote when the permissions read fails', async () => {
    mocks.mockQueryDatasourcePermissions.mockRejectedValue(new Error('403 Forbidden'));

    const result = await getToolResult(stagedArgs);

    expect(result.isError).toBe(false);
    const json = getJson(result);
    expect(json.status).toBe('published');
    expect(json).not.toHaveProperty('permissions');
    expect(json.permissionsNote).toContain('could not be retrieved');
  });

  it('redacts the upload id and file path from logged args', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        ...stagedArgs,
        datasourceFilePath: '/Users/me/secret.tdsx',
        description: undefined,
        overwrite: false,
      },
      getMockExtra(),
    );

    expect(logAndExecute.mock.calls[0][0].args).toEqual({
      datasourceUploadId: '<redacted>',
      datasourceFilePath: '<redacted>',
      name: 'WAM',
      projectId: PROJECT.id,
      description: undefined,
      overwrite: false,
    });
  });
});

function tableauError(
  status: number,
  error: { code?: string; summary?: string; detail?: string },
): AxiosError {
  const axiosError = new AxiosError(`Request failed with status code ${status}`);
  axiosError.response = { status, data: { error } } as AxiosError['response'];
  return axiosError;
}

function getText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function getJson(result: CallToolResult): Record<string, any> {
  return JSON.parse(getText(result));
}

async function getToolResult(args: Args, options: ExtraOptions = {}): Promise<CallToolResult> {
  const tool = getPublishDatasourceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasourceUploadId: args.datasourceUploadId,
      datasourceFilePath: args.datasourceFilePath,
      name: args.name,
      projectId: args.projectId,
      description: args.description,
      overwrite: args.overwrite ?? false,
    },
    getMockExtra(options),
  );
}

function getMockExtra({
  boundedProjectIds = null,
  boundedDatasourceIds = null,
  bucketS3Enabled = true,
  jobTimeoutSeconds = 120,
}: ExtraOptions = {}): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      boundedContext: {
        projectIds: boundedProjectIds,
        datasourceIds: boundedDatasourceIds,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
    config: {
      ...extra.config,
      publishDatasourceJobTimeoutSeconds: jobTimeoutSeconds,
      bucketS3: {
        enabled: bucketS3Enabled,
        bucket: 'tableau-datasources',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
    },
  };
}
