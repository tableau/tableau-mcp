import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({
  deleteSemanticStatements: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.isFeatureEnabled }),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { deleteSemanticStatements: mocks.deleteSemanticStatements } }),
    ),
}));

describe('deleteSemanticStatementsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
  });

  it('is gated behind knowledge-write-tools', async () => {
    expect(await Provider.from(getTool().disabled)).toBe(false);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-write-tools');
  });

  it('is registered with destructive, idempotent annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('delete-knowledge-semantic-contexts');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.contextId.safeParse('semctx/rule').success).toBe(false);
  });

  it('forwards graphId and contextId under the write scope and confirms deletion', async () => {
    mocks.deleteSemanticStatements.mockResolvedValue(undefined);
    const result = await getToolResult({ graphId: 'graph-1', contextId: 'semctx:1' });

    expect(result.isError).not.toBe(true);
    expect(mocks.deleteSemanticStatements).toHaveBeenCalledWith({
      graphId: 'graph-1',
      contextId: 'semctx:1',
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:write'] }),
    );
    expect(JSON.stringify(result)).toContain('semctx:1');
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getDeleteSemanticStatementsTool',
  );
  expect(factory, 'getDeleteSemanticStatementsTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(args: any): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, getMockRequestHandlerExtra());
}
