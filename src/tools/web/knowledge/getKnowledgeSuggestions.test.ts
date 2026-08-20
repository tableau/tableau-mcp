import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetKnowledgeSuggestionsTool } from './getKnowledgeSuggestions.js';

const mocks = vi.hoisted(() => ({ getKnowledgeSuggestions: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      knowledgeMethods: { getKnowledgeSuggestions: mocks.getKnowledgeSuggestions },
    }),
  ),
}));

const emptyReport = {
  health_score: null,
  stats: {
    total_nodes: 0,
    total_relationships: 0,
    connected_sources: 0,
    workbooks: 0,
    context_coverage: null,
  },
  metrics: [],
  suggestions: [],
  categories: [],
  topics: [],
  summary: { total: 0, by_severity: {}, by_type: {}, by_category: {}, by_topic: {}, errors: 0 },
  errors: [],
};

describe('getKnowledgeSuggestionsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has the expected name, arguments, and read-only metadata', async () => {
    const tool = getGetKnowledgeSuggestionsTool(new WebMcpServer());
    expect(tool.name).toBe('get-knowledge-suggestions');
    expect(tool.paramsSchema).toHaveProperty('graphId');
    expect(tool.paramsSchema).toHaveProperty('pdsId');
    expect(tool.paramsSchema).toHaveProperty('severity');
    expect(tool.paramsSchema).toHaveProperty('type');
    expect(tool.paramsSchema).toHaveProperty('limit');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it.each([0, -1])('rejects an invalid limit of %s', async (limit) => {
    const tool = getGetKnowledgeSuggestionsTool(new WebMcpServer());
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.limit.safeParse(limit).success).toBe(false);
  });

  it.each(['graph/1', 'graph?1', '.', '..', '', 'a'.repeat(129)])(
    'rejects an invalid graph ID of %s',
    async (graphId) => {
      const tool = getGetKnowledgeSuggestionsTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.graphId.safeParse(graphId).success).toBe(false);
    },
  );

  it('forwards arguments and the knowledge API scope', async () => {
    mocks.getKnowledgeSuggestions.mockResolvedValue(emptyReport);
    await getToolResult({
      graphId: 'graph-1',
      pdsId: 'pds-1',
      severity: 'low',
      type: 'type-1',
      limit: 2,
    });
    expect(mocks.getKnowledgeSuggestions).toHaveBeenCalledWith({
      graphId: 'graph-1',
      pdsId: 'pds-1',
      severity: 'low',
      type: 'type-1',
      limit: 2,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:knowledge:read'],
      }),
    );
  });

  it('returns a successful full report when suggestions is empty', async () => {
    mocks.getKnowledgeSuggestions.mockResolvedValue(emptyReport);
    const result = await getToolResult({ graphId: 'graph-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual(emptyReport);
  });

  it('applies the configured result limit', async () => {
    mocks.getKnowledgeSuggestions.mockResolvedValue(emptyReport);
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '10' }));

    await getToolResult({ graphId: 'graph-1', limit: 20 }, extra);

    expect(mocks.getKnowledgeSuggestions).toHaveBeenCalledWith({ graphId: 'graph-1', limit: 10 });
  });

  it('applies the default result limit', async () => {
    mocks.getKnowledgeSuggestions.mockResolvedValue(emptyReport);

    await getToolResult({ graphId: 'graph-1' });

    expect(mocks.getKnowledgeSuggestions).toHaveBeenCalledWith({ graphId: 'graph-1', limit: 100 });
  });

  it('funnels downstream errors through the tool error response', async () => {
    mocks.getKnowledgeSuggestions.mockRejectedValue(new Error('knowledge unavailable'));
    const result = await getToolResult({ graphId: 'graph-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('knowledge unavailable');
  });
});

async function getToolResult(
  args: any,
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const tool = getGetKnowledgeSuggestionsTool(new WebMcpServer());
  return (await Provider.from(tool.callback))(args, extra);
}
