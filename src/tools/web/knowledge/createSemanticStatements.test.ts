import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({
  createSemanticStatements: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.isFeatureEnabled }),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { createSemanticStatements: mocks.createSemanticStatements } }),
    ),
}));

describe('createSemanticStatementsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
  });

  it('is disabled when knowledge-write-tools is off', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    expect(await Provider.from(getTool().disabled)).toBe(true);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-write-tools');
  });

  it('redacts statement text from invocation telemetry', async () => {
    mocks.createSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    const tool = getTool();
    const notify = vi.spyOn(tool, 'notifyInvocation');

    await (
      await Provider.from(tool.callback)
    )(
      {
        graphId: 'graph-1',
        targetNodeId: 'field:Revenue',
        statements: [{ statement: 'Revenue excludes tax.' }],
      },
      getMockRequestHandlerExtra(),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ statements: '[REDACTED]' }),
      }),
    );
    expect(mocks.createSemanticStatements).toHaveBeenCalledWith(
      expect.objectContaining({ statements: [{ statement: 'Revenue excludes tax.' }] }),
    );
  });

  it('is registered with direct-mutation annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('create-knowledge-semantic-contexts');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('trims non-empty statements of 5..1000 characters', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.statements.parse([{ statement: '  valid rule  ' }])).toEqual([
      { statement: 'valid rule' },
    ]);
    expect(schema.statements.safeParse([]).success).toBe(false);
    expect(
      schema.statements.safeParse(Array.from({ length: 26 }, () => ({ statement: 'valid' })))
        .success,
    ).toBe(true);
    expect(schema.statements.safeParse([{ statement: 'four' }]).success).toBe(false);
    expect(schema.statements.safeParse([{ statement: 'x'.repeat(1001) }]).success).toBe(false);
  });

  it('requires exactly one attached target or global true', async () => {
    const tool = getTool();
    await expectResultError(tool, {
      graphId: 'graph-1',
      statements: [{ statement: 'valid rule' }],
    });
    await expectResultError(tool, {
      graphId: 'graph-1',
      statements: [{ statement: 'valid rule' }],
      targetNodeId: 'field:Revenue',
      isGlobal: true,
    });
  });

  it('forwards validated input and exact write scope', async () => {
    mocks.createSemanticStatements.mockResolvedValue({ id: 'semctx:1' });
    await getToolResult({
      graphId: 'graph-1',
      statements: [{ statement: ' Revenue excludes refunds. ' }],
      targetNodeId: 'field:Revenue',
      name: 'Revenue rules',
    });
    expect(mocks.createSemanticStatements).toHaveBeenCalledWith({
      graphId: 'graph-1',
      statements: [{ statement: 'Revenue excludes refunds.' }],
      targetNodeId: 'field:Revenue',
      name: 'Revenue rules',
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:write'] }),
    );
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getCreateSemanticStatementsTool',
  );
  expect(factory, 'getCreateSemanticStatementsTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(args: any): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, getMockRequestHandlerExtra());
}

async function expectResultError(tool: any, args: any): Promise<void> {
  const callback = await Provider.from(tool.callback);
  const result = await callback(args, getMockRequestHandlerExtra());
  expect(result.isError).toBe(true);
}
