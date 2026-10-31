import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { buffer } from 'stream/consumers';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import { getDownloadWorkbookTool } from './downloadWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockDownloadWorkbook: vi.fn(),
  mockUpload: vi.fn(),
  mockLog: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        downloadWorkbook: mocks.mockDownloadWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({ upload: mocks.mockUpload })),
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../logging/logger.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

// Shrink the 5 GB cap so the over-cap cases stay tiny.
const { TEST_MAX_BYTES } = vi.hoisted(() => ({ TEST_MAX_BYTES: 64 }));
vi.mock('./stagedWorkbookUpload.js', async (importActual) => ({
  ...(await importActual<typeof import('./stagedWorkbookUpload.js')>()),
  MAX_STAGED_WORKBOOK_BYTES: TEST_MAX_BYTES,
}));

async function* streamOf(...pieces: string[]): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield Buffer.from(piece);
  }
}

describe('downloadWorkbookTool', () => {
  const tempPathsToCleanup: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag !== 'authoring-with-slack');
    mocks.mockIsBlobStorageEnabled.mockReturnValue(false);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempPathsToCleanup.splice(0).map(async (path) => rm(path, { force: true })));
  });

  it('should create a tool instance with correct properties', () => {
    const downloadWorkbookTool = getDownloadWorkbookTool(new WebMcpServer());
    expect(downloadWorkbookTool.name).toBe('download-workbook');
    expect(downloadWorkbookTool.description).toContain('Downloads workbook content');
    expect(downloadWorkbookTool.paramsSchema).toMatchObject({
      workbookId: expect.any(Object),
      includeExtract: expect.any(Object),
    });
  });

  it('is enabled for ChatGPT', async () => {
    const tool = getDownloadWorkbookTool(
      new WebMcpServer({ clientId: 'https://chatgpt.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled for a non-Slack client', async () => {
    const tool = getDownloadWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled for an unknown client', async () => {
    const tool = getDownloadWorkbookTool(new WebMcpServer({ clientId: 'https://example.com/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled for Slack unless authoring-with-slack is enabled', async () => {
    const tool = getDownloadWorkbookTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled for Slack when the authoring-with-slack flag is ON', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    const tool = getDownloadWorkbookTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-with-slack');
  });

  it('is enabled when there is no OAuth client id (stdio)', async () => {
    const tool = getDownloadWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getDownloadWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('should stream workbook bytes to a temp path when blob storage is not configured', async () => {
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf('<work', 'book/>'),
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockDownloadWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });
    expect(result.content).toHaveLength(1);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.filename).toBe('Superstore.twb');
    expect(payload.mimeType).toBe('application/xml');
    expect(payload.path).toMatch(/tableau-mcp-workbooks/);
    tempPathsToCleanup.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(workbookBytes);
    expect(mocks.mockUpload).not.toHaveBeenCalled();
  });

  it('should return a blob storage resource link when blob storage is configured and feature is enabled', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf('<work', 'book/>'),
      contentLength: workbookBytes.byteLength,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });
    let uploadedBytes: Buffer | undefined;
    mocks.mockUpload.mockImplementation(async ({ data }) => {
      uploadedBytes = await buffer(data);
      return { url: 'https://blob.example.com/signed-url' };
    });

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('workbook-file-mode');
    invariant(result.content[0].type === 'resource_link');
    expect(result.content[0].uri).toBe('https://blob.example.com/signed-url');
    expect(result.content[0].name).toBe('Superstore.twb');
    expect(result.content[0].mimeType).toBe('application/xml');
    expect(mocks.mockUpload).toHaveBeenCalledWith({
      key: expect.stringMatching(
        new RegExp(
          `^workbook-files/${MOCK_SITE_LUID}/${MOCK_USER_LUID}/96a43833-27db-40b6-aa80-751efc776b9a/[0-9a-f-]+\\.twb$`,
        ),
      ),
      data: expect.anything(),
      contentLength: workbookBytes.byteLength,
      contentType: 'application/xml',
    });
    expect(uploadedBytes).toEqual(workbookBytes);
  });

  it('fails closed without uploading or writing a temp file when the session has no site LUID', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    const content = Buffer.from('<workbook/>');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      content,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });

    const result = await getToolResult(
      { workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' },
      { _siteLuid: '' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Unable to determine the signed-in Tableau site and user',
    );
    expect(mocks.mockUpload).not.toHaveBeenCalled();
  });

  it('should fall back to temp path and log warning when blob storage upload fails', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf('<work', 'book/>'),
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });
    mocks.mockUpload.mockRejectedValue(new Error('access denied'));

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    tempPathsToCleanup.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(workbookBytes);
    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('access denied'),
      }),
    );
  });

  it('should return temp path when feature flag is disabled even with blob storage configured', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf('<work', 'book/>'),
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('workbook-file-mode');
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    tempPathsToCleanup.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(workbookBytes);
    expect(mocks.mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a plain error', error: new Error('connection reset'), reason: 'connection reset' },
    {
      // Node's happy-eyeballs connect failure: empty message, details on `code`.
      name: 'an AggregateError with an empty message',
      error: Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:8333')], ''), {
        code: 'ECONNREFUSED',
      }),
      reason: 'ECONNREFUSED',
    },
    {
      name: 'an AggregateError with only inner errors',
      error: new AggregateError(
        [
          new Error('connect ECONNREFUSED ::1:8333'),
          new Error('connect ECONNREFUSED 127.0.0.1:8333'),
        ],
        '',
      ),
      reason: 'connect ECONNREFUSED ::1:8333; connect ECONNREFUSED 127.0.0.1:8333',
    },
  ])(
    'should fail with a contextual message without falling back once a failed upload has started reading the stream ($name)',
    async ({ error, reason }) => {
      mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
      mocks.mockDownloadWorkbook.mockResolvedValue({
        fileStream: streamOf('<work', 'book/>'),
        contentType: 'application/xml',
        filename: 'Superstore.twb',
      });
      mocks.mockUpload.mockImplementation(async ({ data }) => {
        for await (const _piece of data) {
          throw error;
        }
      });

      const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        `Failed to store workbook in blob storage: ${reason}`,
      );
      expect(mocks.mockLog).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
    },
  );

  it('should fail without falling back when the provider returns without reading the stream', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'download-workbook-test-'));
    vi.stubEnv('TMPDIR', tempRoot);
    try {
      mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
      const fileStream = Readable.from([Buffer.from('<workbook/>')]);
      mocks.mockDownloadWorkbook.mockResolvedValue({
        fileStream,
        contentType: 'application/xml',
        filename: 'Superstore.twb',
      });
      mocks.mockUpload.mockResolvedValue({ url: 'https://blob.example.com/signed-url' });

      const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Blob storage provider returned without reading the upload data',
      );
      await vi.waitFor(() => expect(fileStream.destroyed).toBe(true));
      expect(mocks.mockLog).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
      await expect(readdir(tempRoot)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('should destroy the source stream when the feature gate check rejects', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => {
      if (flag === 'workbook-file-mode') {
        throw new Error('gate unavailable');
      }
      return flag !== 'authoring-with-slack';
    });
    const fileStream = Readable.from([Buffer.from('<workbook/>')]);
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });

    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('gate unavailable');
    await vi.waitFor(() => expect(fileStream.destroyed).toBe(true));
    expect(mocks.mockUpload).not.toHaveBeenCalled();
  });

  it('should destroy the source stream when the temp directory cannot be created', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'download-workbook-test-'));
    vi.stubEnv('TMPDIR', tempRoot);
    try {
      // A file where the temp directory should be makes `mkdir` reject.
      await writeFile(join(tempRoot, 'tableau-mcp-workbooks'), '');
      const fileStream = Readable.from([Buffer.from('<workbook/>')]);
      mocks.mockDownloadWorkbook.mockResolvedValue({
        fileStream,
        contentType: 'application/xml',
        filename: 'Superstore.twb',
      });

      const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

      expect(result.isError).toBe(true);
      await vi.waitFor(() => expect(fileStream.destroyed).toBe(true));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('should return a blob storage resource link for an empty workbook the provider drained', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf(),
      contentLength: 0,
      contentType: 'application/xml',
      filename: 'Empty.twb',
    });
    let uploadedBytes: Buffer | undefined;
    mocks.mockUpload.mockImplementation(async ({ data }) => {
      uploadedBytes = await buffer(data);
      return { url: 'https://blob.example.com/signed-url' };
    });

    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'resource_link');
    expect(result.content[0].uri).toBe('https://blob.example.com/signed-url');
    expect(uploadedBytes).toEqual(Buffer.alloc(0));
  });

  it('should reject a workbook whose Content-Length exceeds the cap before reading it', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    let read = false;
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: (async function* () {
        read = true;
        yield Buffer.from('x');
      })(),
      contentLength: TEST_MAX_BYTES + 1,
      contentType: 'application/octet-stream',
    });

    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      `exceeds the maximum allowed size of ${TEST_MAX_BYTES} bytes`,
    );
    expect(read).toBe(false);
    expect(mocks.mockUpload).not.toHaveBeenCalled();
  });

  it('should fail the upload when the stream exceeds the cap mid-read', async () => {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockDownloadWorkbook.mockResolvedValue({
      fileStream: streamOf('a'.repeat(TEST_MAX_BYTES), 'b'),
      contentType: 'application/octet-stream',
    });
    mocks.mockUpload.mockImplementation(async ({ data }) => {
      await buffer(data);
      return { url: 'https://blob.example.com/signed-url' };
    });

    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      `exceeds the maximum allowed size of ${TEST_MAX_BYTES} bytes`,
    );
  });

  it('should delete the partial temp file when the stream exceeds the cap or fails mid-read', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'download-workbook-test-'));
    vi.stubEnv('TMPDIR', tempRoot);
    try {
      mocks.mockDownloadWorkbook.mockResolvedValueOnce({
        fileStream: streamOf('a'.repeat(TEST_MAX_BYTES), 'b'),
        contentType: 'application/octet-stream',
      });
      const overCap = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });
      expect(overCap.isError).toBe(true);
      invariant(overCap.content[0].type === 'text');
      expect(overCap.content[0].text).toContain('exceeds the maximum allowed size');

      mocks.mockDownloadWorkbook.mockResolvedValueOnce({
        fileStream: (async function* () {
          yield Buffer.from('partial');
          throw new Error('socket hang up');
        })(),
        contentType: 'application/octet-stream',
      });
      const failed = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });
      expect(failed.isError).toBe(true);
      invariant(failed.content[0].type === 'text');
      expect(failed.content[0].text).toContain('socket hang up');

      await expect(readdir(join(tempRoot, 'tableau-mcp-workbooks'))).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('should return workbook not allowed error when workbook is not allowed', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not allowed');
    expect(mocks.mockDownloadWorkbook).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    mocks.mockDownloadWorkbook.mockRejectedValue(new Error('API Error'));

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });
});

async function getToolResult(
  params: {
    workbookId: string;
    includeExtract?: boolean;
  },
  extraOverrides: Parameters<typeof getMockRequestHandlerExtra>[0] = {},
): Promise<CallToolResult> {
  const downloadWorkbookTool = getDownloadWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(downloadWorkbookTool.callback);
  return await callback(
    {
      workbookId: params.workbookId,
      includeExtract: params.includeExtract,
    },
    getMockRequestHandlerExtra(extraOverrides),
  );
}
