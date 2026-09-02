import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({
  updateSemanticStatements: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.isFeatureEnabled }),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { updateSemanticStatements: mocks.updateSemanticStatements } }),
    ),
}));

describe('updateSemanticStatementsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
  });

  it('is enabled when knowledge-write-tools is on', async () => {
    expect(await Provider.from(getTool().disabled)).toBe(false);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-write-tools');
  });

  it('redacts statement text from invocation telemetry', async () => {
    mocks.updateSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    const tool = getTool();
    const notify = vi.spyOn(tool, 'notifyInvocation');

    await (
      await Provider.from(tool.callback)
    )(
      {
        graphId: 'graph-1',
        contextId: 'semctx:1',
        statements: [{ statement: 'Revenue includes services.' }],
      },
      getMockRequestHandlerExtra(),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ statements: '[REDACTED]' }),
      }),
    );
    expect(mocks.updateSemanticStatements).toHaveBeenCalledWith(
      expect.objectContaining({ statements: [{ statement: 'Revenue includes services.' }] }),
    );
  });

  it('is registered with destructive direct-mutation annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('update-knowledge-semantic-contexts');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.contextId.safeParse('semctx/rule').success).toBe(false);
  });

  it('rejects an empty update and validates replacement statements', async () => {
    const empty = await getToolResult({ graphId: 'graph-1', contextId: 'semctx:1' });
    expect(empty.isError).toBe(true);
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.statements.safeParse([]).success).toBe(false);
    expect(schema.statements.safeParse([{ statement: 'four' }]).success).toBe(false);
  });

  it.each([
    [{ isGlobal: true }, false],
    [{ isGlobal: false }, false],
    [{ targetNodeId: null }, false],
    [{ isGlobal: true, targetNodeId: 'field:Revenue' }, false],
    [{ isGlobal: false, targetNodeId: null }, false],
    [{ isGlobal: true, targetNodeId: null }, true],
    [{ isGlobal: false, targetNodeId: 'field:Revenue' }, true],
    [{ targetNodeId: 'field:Profit' }, false],
  ])('enforces attachment transition combination %j', async (transition, valid) => {
    mocks.updateSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    const result = await getToolResult({
      graphId: 'graph-1',
      contextId: 'semctx:1',
      ...transition,
    });
    expect(result.isError).toBe(!valid);
  });

  it.each([
    { statements: [{ statement: 'Revenue includes services.' }] },
    { name: 'Revenue rules' },
  ])('accepts a content-only update %j', async (update) => {
    mocks.updateSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    const result = await getToolResult({
      graphId: 'graph-1',
      contextId: 'semctx:1',
      ...update,
    });
    expect(result.isError).not.toBe(true);
  });

  it('forwards explicit null, replacement statements, and write scope', async () => {
    mocks.updateSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    await getToolResult({
      graphId: 'graph-1',
      contextId: 'semctx:1',
      statements: [{ id: 'stmt:1', statement: ' Updated revenue rule. ' }],
      isGlobal: true,
      targetNodeId: null,
    });
    expect(mocks.updateSemanticStatements).toHaveBeenCalledWith({
      graphId: 'graph-1',
      contextId: 'semctx:1',
      statements: [{ id: 'stmt:1', statement: 'Updated revenue rule.' }],
      isGlobal: true,
      targetNodeId: null,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:write'] }),
    );
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getUpdateSemanticStatementsTool',
  );
  expect(factory, 'getUpdateSemanticStatementsTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(args: any): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, getMockRequestHandlerExtra());
}
