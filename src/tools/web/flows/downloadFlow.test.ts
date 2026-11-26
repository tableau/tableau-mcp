import { readFile, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { getConfig } from '../../../config.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { getDownloadFlowTool, getFlowFileMetadata } from './downloadFlow.js';

const mocks = vi.hoisted(() => ({
  allowed: vi.fn(),
  download: vi.fn(),
  flag: vi.fn(),
  query: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isFlowAllowed: mocks.allowed },
}));
vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.flag }),
}));
vi.mock('../s3Client.js', async (original) => ({
  ...(await original<typeof import('../s3Client.js')>()),
  uploadBufferToS3: mocks.upload,
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: async ({ callback }: { callback: (api: unknown) => unknown }) =>
    callback({
      siteId: 'site',
      flowsMethods: { downloadFlow: mocks.download, queryFlow: mocks.query },
    }),
}));
const flowId = '96a43833-27db-40b6-aa80-751efc776b9a';
const directories: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue({ allowed: true });
  mocks.flag.mockResolvedValue(true);
  mocks.query.mockResolvedValue({
    flow: { id: flowId, name: 'Example', fileType: 'tfl' },
    outputSteps: [],
  });
  mocks.download.mockResolvedValue({
    content: Buffer.from('{"flow":{}}'),
    filename: 'Example.tfl',
  });
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});
describe('download-flow', () => {
  it('uses the flow gate, group and documented scopes', async () => {
    const tool = getDownloadFlowTool(new WebMcpServer());
    expect(webToolGroups.flow).toContain(tool.name);
    expect(tool.requiredApiScopes).toEqual(
      expect.arrayContaining(['tableau:flows:download', 'tableau:flows:read']),
    );
    vi.stubEnv('FLOW_READ_TOOLS_ENABLED', 'false');
    expect(await Provider.from(tool.disabled)).toBe(true);
  });
  it.each([
    { bytes: Buffer.from('{"flow":{}}'), ext: 'tfl' },
    { bytes: Buffer.from([0x50, 0x4b, 3, 4, 0, 255]), ext: 'tfl' },
    { bytes: Buffer.from([0x50, 0x4b, 3, 4, 0, 255]), ext: 'tflx' },
  ])('delivers unchanged $ext bytes through a safe local file', async ({ bytes, ext }) => {
    mocks.download.mockResolvedValue({ content: bytes, filename: `../../untrusted.${ext}` });
    const tool = getDownloadFlowTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ flowId }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(false);
    const item = result.content[0];
    if (item.type !== 'text') throw new Error('Expected local file metadata');
    const data = JSON.parse(item.text);
    directories.push(dirname(data.path));
    expect(data.filename).toBe(basename(data.path));
    expect(data.filename).not.toContain('..');
    expect(data.filename.endsWith(`.${ext}`)).toBe(true);
    await expect(readFile(data.path)).resolves.toEqual(bytes);
  });
  it('uses unique safe names for hostile server metadata', () => {
    const metadata = getFlowFileMetadata(
      { content: Buffer.from('{}'), filename: '../CON\r\nX_injected.tfl' },
      flowId,
    );
    expect(metadata?.filename).toMatch(/^[A-Za-z0-9_-]+\.tfl$/);
  });
  it('uses verified flow metadata when a filename is absent', async () => {
    mocks.download.mockResolvedValue({ content: Buffer.from([0x50, 0x4b, 3, 4, 0]) });
    const tool = getDownloadFlowTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ flowId }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(false);
    const item = result.content[0];
    if (item.type !== 'text') throw new Error('Expected file metadata');
    const data = JSON.parse(item.text);
    directories.push(dirname(data.path));
    expect(data.filename.endsWith('.tfl')).toBe(true);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith({ siteId: 'site', flowId });
  });
  it('refuses to guess a file format from an unidentified response', async () => {
    mocks.download.mockResolvedValue({ content: Buffer.from('{}') });
    mocks.query.mockResolvedValue({ flow: { id: flowId, name: 'Example' }, outputSteps: [] });
    const tool = getDownloadFlowTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ flowId }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('refuses out-of-context downloads before contacting Tableau', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'Outside flow bounds' });
    const tool = getDownloadFlowTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ flowId }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('returns a presigned resource link when file storage is configured', async () => {
    mocks.upload.mockResolvedValue('https://storage.example/flow.tfl?expires=short');
    const config = {
      ...getConfig(),
      bucketS3: {
        ...getConfig().bucketS3,
        enabled: true,
        bucket: 'test-bucket',
        region: 'test-region',
        keyPrefix: 'safe/',
      },
    };
    const tool = getDownloadFlowTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ flowId }, getMockRequestHandlerExtra({ config }));
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({
      type: 'resource_link',
      mimeType: 'application/octet-stream',
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      Buffer.from('{"flow":{}}'),
      expect.objectContaining({
        key: expect.stringMatching(/^safe\/flow-files\//),
        contentType: 'application/octet-stream',
      }),
    );
  });
  it('surfaces download errors without emitting a file', async () => {
    mocks.download.mockRejectedValue(new Error('Download permission required'));
    const tool = getDownloadFlowTool(new WebMcpServer());
    expect(
      (await (await Provider.from(tool.callback))({ flowId }, getMockRequestHandlerExtra()))
        .isError,
    ).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
