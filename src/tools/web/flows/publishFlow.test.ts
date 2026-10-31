import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../config.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { getPublishFlowTool } from './publishFlow.js';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  publish: vi.fn(),
  flag: vi.fn(),
  resolveStaged: vi.fn(),
}));
vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.flag }),
}));
vi.mock('./stagedFlowUpload.js', async (original) => ({
  ...(await original<typeof import('./stagedFlowUpload.js')>()),
  resolveStagedFlowUpload: mocks.resolveStaged,
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: async ({ callback }: { callback: (api: unknown) => unknown }) =>
    callback({
      siteId: 'site',
      publishingMethods: { uploadFileInChunks: mocks.upload },
      flowsMethods: { publishFlow: mocks.publish },
    }),
}));
const projectId = '1f13d4b2-7e91-4680-a5a0-96e65e8b1234';
const flow = { id: 'flow', name: 'Example', project: { id: projectId }, fileType: 'tfl' };
let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.flag.mockResolvedValue(true);
  mocks.upload.mockResolvedValue('upload-session');
  mocks.publish.mockResolvedValue(flow);
  directory = await mkdtemp(join(tmpdir(), 'publish-flow-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function extra(
  transport: 'stdio' | 'http' = 'stdio',
  s3 = false,
): ReturnType<typeof getMockRequestHandlerExtra> {
  return getMockRequestHandlerExtra({
    config: { ...getConfig(), transport, bucketS3: { ...getConfig().bucketS3, enabled: s3 } },
  });
}
async function call(
  input: { flowFilePath?: string; flowUploadId?: string; overwrite?: boolean },
  context = extra(),
): Promise<CallToolResult> {
  const tool = getPublishFlowTool(new WebMcpServer());
  return await (
    await Provider.from(tool.callback)
  )(
    {
      name: 'Example',
      projectId,
      flowFilePath: input.flowFilePath,
      flowUploadId: input.flowUploadId,
      overwrite: false,
      ...input,
    },
    context,
  );
}
describe('publish-flow', () => {
  it('uses write/authoring gates, flow group and publish/upload scopes', async () => {
    const tool = getPublishFlowTool(new WebMcpServer());
    expect(webToolGroups.flow).toContain(tool.name);
    expect(tool.requiredApiScopes).toEqual(
      expect.arrayContaining(['tableau:flows:create', 'tableau:file_uploads:create']),
    );
    vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', 'false');
    expect(await Provider.from(tool.disabled)).toBe(true);
  });
  it.each(['tfl', 'tflx'])(
    'publishes a local %s with overwrite off and a fixed safe multipart filename',
    async (extension) => {
      const path = join(directory, `Example.${extension}`);
      const bytes = Buffer.from('flow fixture');
      await writeFile(path, bytes);
      const result = await call({ flowFilePath: path });
      expect(result.isError).toBe(false);
      expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({
        siteId: 'site',
        filename: `flow.${extension}`,
        content: bytes,
      });
      expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
        siteId: 'site',
        uploadSessionId: 'upload-session',
        flowType: extension,
        name: 'Example',
        projectId,
        overwrite: false,
      });
    },
  );
  it('honors explicit overwrite under a project-only context', async () => {
    const path = join(directory, 'Example.tfl');
    await writeFile(path, '{}');
    expect((await call({ flowFilePath: path, overwrite: true })).isError).toBe(false);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }));
  });
  it('refuses ambiguous overwrite when flows are restricted by tag', async () => {
    const context = extra();
    vi.mocked(context.getConfigWithOverrides).mockResolvedValue({
      boundedContext: { projectIds: null, tags: new Set(['allowed']) },
    } as Awaited<ReturnType<typeof context.getConfigWithOverrides>>);
    expect((await call({ flowUploadId: 'staged', overwrite: true }, context)).isError).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([{}, { flowFilePath: 'local.tfl', flowUploadId: 'staged' }])(
    'requires exactly one file input %j',
    async (input) => {
      expect((await call(input)).isError).toBe(true);
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
  it('denies server-local files on HTTP before reading or uploading', async () => {
    expect(
      (await call({ flowFilePath: join(directory, 'private.tfl') }, extra('http'))).isError,
    ).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(['wrong.txt', 'empty.tfl'])(
    'rejects invalid or empty files before an upload: %s',
    async (name) => {
      const path = join(directory, name);
      await writeFile(path, '');
      expect((await call({ flowFilePath: path })).isError).toBe(true);
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
  it('denies an excluded destination before resolving a file', async () => {
    const context = extra();
    vi.mocked(context.getConfigWithOverrides).mockResolvedValue({
      boundedContext: { projectIds: new Set(['other']), tags: null },
    } as Awaited<ReturnType<typeof context.getConfigWithOverrides>>);
    expect((await call({ flowFilePath: 'missing.tfl' }, context)).isError).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('publishes a resolved staged flow on HTTP with configured storage', async () => {
    mocks.resolveStaged.mockResolvedValue({
      fileName: 'flow.tflx',
      bytes: Buffer.from('packaged fixture'),
    });
    expect((await call({ flowUploadId: 'staged' }, extra('http', true))).isError).toBe(false);
    expect(mocks.resolveStaged).toHaveBeenCalledWith(
      expect.objectContaining({ flowUploadId: 'staged', maxBytes: 256 * 1024 * 1024 }),
    );
  });
  it('reports uncertain identity/project responses without repeating the mutation', async () => {
    const path = join(directory, 'Example.tfl');
    await writeFile(path, '{}');
    mocks.publish.mockResolvedValue({ ...flow, project: { id: 'different' } });
    const result = await call({ flowFilePath: path });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have succeeded');
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});
