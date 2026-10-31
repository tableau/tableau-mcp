import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { getUpdateFlowConnectionTool } from './updateFlowConnection.js';

const mocks = vi.hoisted(() => ({
  allowed: vi.fn(),
  connections: vi.fn(),
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
      flowsMethods: { queryFlowConnections: mocks.connections, updateFlowConnection: mocks.update },
    }),
}));
const flowId = '96a43833-27db-40b6-aa80-751efc776b9a';
const connectionId = '1f13d4b2-7e91-4680-a5a0-96e65e8b1234';
async function call(
  updates: { serverAddress?: string; serverPort?: number; userName?: string } = {
    serverAddress: 'new.example',
  },
): Promise<CallToolResult> {
  const tool = getUpdateFlowConnectionTool(new WebMcpServer());
  return await (
    await Provider.from(tool.callback)
  )(
    {
      flowId,
      connectionId,
      serverAddress: updates.serverAddress,
      serverPort: updates.serverPort,
      userName: updates.userName,
    },
    getMockRequestHandlerExtra(),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue({ allowed: true });
  mocks.flag.mockResolvedValue(true);
  mocks.connections.mockResolvedValue([{ id: connectionId, serverAddress: 'old.example' }]);
  mocks.update.mockResolvedValue({ id: connectionId, serverAddress: 'new.example' });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('update-flow-connection', () => {
  it('requires the administrator role and connection read/update scopes', async () => {
    const tool = getUpdateFlowConnectionTool(new WebMcpServer());
    expect(tool.minRequiredRole).toBe('SiteAdministratorExplorer');
    expect(webToolGroups.flow).toContain(tool.name);
    expect(tool.requiredApiScopes).toEqual(
      expect.arrayContaining([
        'tableau:flow_connections:read',
        'tableau:flow_connections:update',
        'tableau:flows:read',
      ]),
    );
    vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', 'false');
    expect(await Provider.from(tool.disabled)).toBe(true);
  });
  it('checks membership and sends exactly the requested endpoint', async () => {
    expect((await call()).isError).toBe(false);
    expect(mocks.connections).toHaveBeenCalledExactlyOnceWith({ siteId: 'site', flowId });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      siteId: 'site',
      flowId,
      connectionId,
      updates: { serverAddress: 'new.example' },
    });
  });
  it('refuses a connection that does not belong to the requested flow', async () => {
    mocks.connections.mockResolvedValue([{ id: flowId }]);
    expect((await call()).isError).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses an empty update before any API access', async () => {
    expect((await call({})).isError).toBe(true);
    expect(mocks.allowed).not.toHaveBeenCalled();
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses an excluded flow before a write', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'Excluded flow' });
    expect((await call()).isError).toBe(true);
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not claim success for a mismatched returned identity', async () => {
    mocks.update.mockResolvedValue({ id: flowId, serverAddress: 'new.example' });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have succeeded');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('reports an unchanged response as unverified rather than updated', async () => {
    mocks.update.mockResolvedValue({ id: connectionId, serverAddress: 'old.example' });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have succeeded');
  });
  it('propagates a connector refusal and makes no automatic retry', async () => {
    mocks.update.mockRejectedValue(new Error('Connection update forbidden'));
    const result = await call();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Connection update forbidden');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
