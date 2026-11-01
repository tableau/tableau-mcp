import { resolve } from 'node:path';

import { z } from 'zod';

import { Config } from '../../../config.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  getRequiredApiScopesForTool,
  getRequiredScopesForTool,
  getSupportedMcpScopes,
} from '../../../server/oauth/scopes.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGeneratePrepFlowTool } from './generatePrepFlow.js';
import { getPreparePrepFlowEditTool } from './preparePrepFlowEdit.js';

const mocks = vi.hoisted(() => ({
  engine: vi.fn(),
  allowed: vi.fn(),
  download: vi.fn(),
  useRest: vi.fn(),
  config: {} as Config,
  flowReads: true,
}));
vi.mock('../../../config.js', async (original) => ({
  ...(await original<typeof import('../../../config.js')>()),
  getConfig: () => mocks.config,
}));
vi.mock('./engineClient.js', async (original) => ({
  ...(await original<typeof import('./engineClient.js')>()),
  runPrepEngine: mocks.engine,
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isFlowAllowed: mocks.allowed },
}));
vi.mock('../../../features/flowTools.js', () => ({
  isFlowReadToolsEnabled: async () => mocks.flowReads,
  isFlowWriteToolsEnabled: async () => false,
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: (args: unknown) => mocks.useRest(args),
}));
vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: async () => false }),
}));

describe('source-bound compact YAML workflow', () => {
  let api: typeof import('./workflow.js');
  const flowId = '11111111-1111-4111-8111-111111111111';
  const previewId = '22222222-2222-4222-8222-222222222222';
  const sha = 'b'.repeat(64);
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.config = Object.assign(new Config(), {
      transport: 'stdio',
      prepAuthoring: { enabled: true, python: resolve('python'), workspace: resolve('tmp') },
    });
    mocks.flowReads = true;
    mocks.allowed.mockResolvedValue({ allowed: true });
    mocks.download.mockResolvedValue(Buffer.from('native'));
    mocks.useRest.mockImplementation(async ({ callback }) =>
      callback({ siteId: flowId, flowsMethods: { downloadFlowContent: mocks.download } }),
    );
    mocks.engine.mockResolvedValue({
      ok: true,
      valid: true,
      yaml: 'compact: yaml',
      projectSha256: 'a'.repeat(64),
      sourceSha256: 'c'.repeat(64),
    });
    api = await import('./workflow.js');
  });
  const extra = (): ReturnType<typeof getMockRequestHandlerExtra> => getMockRequestHandlerExtra();
  const prepare = async (source: Record<string, unknown> = { type: 'new' }): Promise<string> =>
    (await api.preparePrepEdit(z.object(api.prepareParams).parse({ source }), extra()))
      .sourceHandle;
  const args = (
    handle: string,
    overrides: Record<string, unknown> = {},
  ): z.infer<z.ZodObject<typeof api.generateParams>> =>
    z.object(api.generateParams).parse({
      sourceHandle: handle,
      yaml: 'compact: yaml',
      format: 'tflx',
      target: 'cloud',
      ...overrides,
    });

  it('uses no Tableau request for new/local preparation and carries selected resources', async () => {
    await api.preparePrepEdit(
      z.object(api.prepareParams).parse({
        source: { type: 'local', path: 'flows/input.tflx' },
        resources: ['data/choices.json'],
      }),
      extra(),
    );
    expect(mocks.useRest).not.toHaveBeenCalled();
    expect(mocks.allowed).not.toHaveBeenCalled();
    expect(mocks.engine.mock.calls[0][1]).toMatchObject({
      operation: 'prepare',
      source: { type: 'local', path: 'flows/input.tflx' },
      resources: ['data/choices.json'],
    });
  });
  it('authorizes a published origin before the fixed native download', async () => {
    await prepare({ type: 'published', flowId });
    expect(mocks.allowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0],
    );
    expect(mocks.download.mock.calls[0][0]).toMatchObject({ siteId: flowId, flowId });
    expect(mocks.engine.mock.calls[0][1].source).toEqual({
      type: 'download',
      base64: Buffer.from('native').toString('base64'),
    });
  });
  it('downloads nothing for a forbidden flow or disabled Prep reads', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'outside boundary' });
    await expect(prepare({ type: 'published', flowId })).rejects.toThrow();
    mocks.flowReads = false;
    await expect(prepare({ type: 'published', flowId })).rejects.toThrow('disabled');
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.engine).not.toHaveBeenCalled();
  });
  it('requires the exact successful preview for generation and returns official notices', async () => {
    const handle = await prepare();
    await expect(
      api.generatePrepFlow(args(handle, { mode: 'generate', expectedPreviewSha256: sha }), extra()),
    ).rejects.toThrow('successful preview');
    mocks.engine.mockResolvedValue({
      ok: true,
      valid: true,
      previewId,
      previewSha256: sha,
      summary: { hasScriptSteps: true, hasInputUnion: false, hasFileInputs: false },
    });
    const preview = await api.generatePrepFlow(args(handle), extra());
    expect(preview.compatibility?.publicationReadiness).toBe('unsupported');
    await expect(
      api.generatePrepFlow(
        args(handle, { mode: 'generate', expectedPreviewSha256: sha, yaml: 'changed: yaml' }),
        extra(),
      ),
    ).rejects.toThrow('exact YAML');
    mocks.engine.mockResolvedValue({
      ok: true,
      valid: true,
      path: `.tableau-prep-mcp/${handle}/${previewId}/generated.tflx`,
      sha256: sha,
      summary: { hasScriptSteps: false, hasInputUnion: true, hasFileInputs: true },
    });
    const generated = await api.generatePrepFlow(
      args(handle, { mode: 'generate', expectedPreviewSha256: sha }),
      extra(),
    );
    expect(mocks.engine.mock.calls.at(-1)?.[1]).toMatchObject({
      operation: 'generate',
      previewId,
      previewSha256: sha,
    });
    expect(generated.compatibility?.notices.some((n) => n.code === 'CLOUD_FILE_REFRESH')).toBe(
      true,
    );
  });
  it('checks the published boundary again before processing a saved handle', async () => {
    const handle = await prepare({ type: 'published', flowId });
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'boundary changed' });
    await expect(api.generatePrepFlow(args(handle), extra())).rejects.toThrow();
    expect(mocks.engine).toHaveBeenCalledOnce();
  });
  it('rejects HTTP and opt-out callbacks before engine or Tableau calls', async () => {
    mocks.config.transport = 'http';
    await expect(prepare()).rejects.toThrow('opt-in stdio');
    mocks.config.transport = 'stdio';
    mocks.config.prepAuthoring.enabled = false;
    await expect(prepare()).rejects.toThrow('opt-in stdio');
    expect(mocks.useRest).not.toHaveBeenCalled();
    expect(mocks.engine).not.toHaveBeenCalled();
  });
  it('rejects unknown handles and invalid previews rather than inventing a candidate', async () => {
    await expect(api.generatePrepFlow(args(flowId), extra())).rejects.toThrow('unavailable');
    const handle = await prepare();
    mocks.engine.mockResolvedValue({ ok: true, valid: false, errorCount: 1 });
    const result = await api.generatePrepFlow(args(handle), extra());
    expect(result.compatibility).toBeUndefined();
    await expect(
      api.generatePrepFlow(args(handle, { mode: 'generate', expectedPreviewSha256: sha }), extra()),
    ).rejects.toThrow('successful preview');
  });
  it('expires handles and bounds even identical preview attempts', async () => {
    const handle = await prepare();
    mocks.engine.mockResolvedValue({ ok: true, valid: true, previewId, previewSha256: sha });
    for (let i = 0; i < 10; i++) await api.generatePrepFlow(args(handle), extra());
    await expect(api.generatePrepFlow(args(handle), extra())).rejects.toThrow('preview limit');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    try {
      await expect(api.generatePrepFlow(args(handle), extra())).rejects.toThrow('expired');
    } finally {
      now.mockRestore();
    }
  });
  it('admits only one operation at a time and releases its guard after completion', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.engine.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = prepare();
    await expect(prepare()).rejects.toThrow('operation is active');
    release({ ok: true, valid: true, yaml: 'compact: yaml', projectSha256: 'a'.repeat(64) });
    await pending;
    mocks.engine.mockResolvedValue({
      ok: true,
      valid: true,
      yaml: 'compact: yaml',
      projectSha256: 'a'.repeat(64),
    });
    await expect(prepare()).resolves.toBeDefined();
  });
  it('keeps raw YAML out of invocation arguments while retaining the actual callback input', async () => {
    const tool = getGeneratePrepFlowTool(new WebMcpServer());
    const spy = vi.spyOn(tool, 'logAndExecute').mockResolvedValue({ content: [] });
    const callback = await Provider.from(tool.callback);
    await callback(
      { ...args(flowId, { yaml: 'PRIVATE_YAML' }), expectedPreviewSha256: undefined },
      extra(),
    );
    expect(spy.mock.calls[0][0].args.yaml).toBe('[omitted from invocation logs]');
  });
  it('aligns optional registration and MCP/API scope exposure', async () => {
    expect(getRequiredScopesForTool('prepare-prep-flow-edit')).toEqual(['tableau:mcp:prep:author']);
    expect(getRequiredApiScopesForTool('prepare-prep-flow-edit')).toContain(
      'tableau:flows:download',
    );
    expect(await getSupportedMcpScopes()).toContain('tableau:mcp:prep:author');
    const prepareTool = getPreparePrepFlowEditTool(new WebMcpServer());
    expect(await Provider.from(prepareTool.disabled)).toBe(false);
    mocks.config.transport = 'http';
    expect(await Provider.from(prepareTool.disabled)).toBe(true);
    expect(await getSupportedMcpScopes()).not.toContain('tableau:mcp:prep:author');
  });
});
