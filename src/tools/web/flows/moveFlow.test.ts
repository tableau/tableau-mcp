import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { getMoveFlowTool } from './moveFlow.js';

const mocks = vi.hoisted(() => ({
  allowed: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  flag: vi.fn(),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isFlowAllowed: mocks.allowed },
}));
vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.flag }),
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: async ({ callback }: { callback: (api: unknown) => unknown }) =>
    callback({
      siteId: 'site',
      flowsMethods: { queryFlow: mocks.query, updateFlow: mocks.update },
    }),
}));
const flowId = '96a43833-27db-40b6-aa80-751efc776b9a';
const projectId = '1f13d4b2-7e91-4680-a5a0-96e65e8b1234';
const originalProject = '2f13d4b2-7e91-4680-a5a0-96e65e8b1234';
const owner = { id: 'original-owner' };
async function call(extra = getMockRequestHandlerExtra()): Promise<CallToolResult> {
  const tool = getMoveFlowTool(new WebMcpServer());
  return await (
    await Provider.from(tool.callback)
  )({ flowId, projectId }, extra);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue({ allowed: true });
  mocks.flag.mockResolvedValue(true);
  mocks.query.mockResolvedValue({
    flow: { id: flowId, name: 'Example', project: { id: originalProject }, owner },
    outputSteps: [],
  });
  mocks.update.mockResolvedValue({
    id: flowId,
    name: 'Example',
    project: { id: projectId },
    owner,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('move-flow', () => {
  it('uses the write gate, group, role and update scopes', async () => {
    const tool = getMoveFlowTool(new WebMcpServer());
    expect(webToolGroups.flow).toContain(tool.name);
    expect(tool.minRequiredRole).toBe('ExplorerCanPublish');
    expect(tool.requiredApiScopes).toEqual(
      expect.arrayContaining(['tableau:flows:update', 'tableau:flows:read']),
    );
    vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', 'false');
    expect(await Provider.from(tool.disabled)).toBe(true);
  });
  it('sends only the requested project and preserves the returned owner', async () => {
    const result = await call();
    expect(result.isError).toBe(false);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ siteId: 'site', flowId, projectId });
    expect(JSON.stringify(result)).toContain('original-owner');
    expect(JSON.stringify(result)).toContain('moved');
  });
  it('returns unchanged without writing when already in the destination', async () => {
    mocks.query.mockResolvedValue({
      flow: { id: flowId, name: 'Example', project: { id: projectId }, owner },
      outputSteps: [],
    });
    const result = await call();
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain('unchanged');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses an excluded source before reading or writing', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'Excluded flow' });
    expect((await call()).isError).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses an excluded destination before writing', async () => {
    const extra = getMockRequestHandlerExtra();
    vi.mocked(extra.getConfigWithOverrides).mockResolvedValue({
      boundedContext: { projectIds: new Set([originalProject]) },
    } as Awaited<ReturnType<typeof extra.getConfigWithOverrides>>);
    expect((await call(extra)).isError).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses a mismatched source identity before writing', async () => {
    mocks.query.mockResolvedValue({ flow: { id: projectId, name: 'Wrong' }, outputSteps: [] });
    expect((await call()).isError).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not claim a successful move for an unverified response', async () => {
    mocks.update.mockResolvedValue({
      id: flowId,
      name: 'Example',
      project: { id: originalProject },
    });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have succeeded');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('propagates a permission or name-conflict error without retrying', async () => {
    mocks.update.mockRejectedValue(new Error('Project update forbidden'));
    const result = await call();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Project update forbidden');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed target IDs at the input boundary', async () => {
    const tool = getMoveFlowTool(new WebMcpServer());
    expect(
      z.object(await Provider.from(tool.paramsSchema)).safeParse({ flowId: '../escape', projectId })
        .success,
    ).toBe(false);
  });
});
