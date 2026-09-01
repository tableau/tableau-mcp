import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ listKnowledgeSources: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      knowledgeMethods: { listKnowledgeSources: mocks.listKnowledgeSources },
    }),
  ),
}));

const sources = [
  {
    id: 'pds-1',
    type: 'PDS',
    name: 'Sales Data',
    properties: { connection_type: 'snowflake', arbitrary: { preserved: true } },
    sync_status: 'idle',
    last_synced_at: null,
  },
  {
    id: 'workbook-1',
    type: 'WORKBOOK',
    name: 'Executive Overview',
    properties: { project_id: 'project-1' },
    sync_status: 'syncing',
    last_synced_at: '2026-08-12T15:04:05Z',
  },
];

describe('listKnowledgeSourcesTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has the expected arguments and read-only metadata', async () => {
    const tool = getTool();
    expect(tool.name).toBe('list-knowledge-sources');
    expect(tool.description).toContain("source's top-level id is a Knowledge graph node ID");
    expect(tool.description).toContain('properties.luid as the Tableau content LUID');
    expect(tool.description).toContain('published data sources and workbooks');
    expect(tool.description).toContain('do not invent one');
    expect(tool.paramsSchema).toHaveProperty('graphId');
    expect(tool.paramsSchema).toHaveProperty('nodeType');
    expect(tool.paramsSchema).toHaveProperty('limit');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it.each(['graph/1', 'graph?1', '.', '..', '', 'a'.repeat(129)])(
    'rejects an invalid graph ID of %s',
    async (graphId) => {
      const schema = await Provider.from(getTool().paramsSchema);
      expect(schema.graphId.safeParse(graphId).success).toBe(false);
    },
  );

  it('rejects an unsupported node type', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.nodeType.safeParse('FLOW').success).toBe(false);
  });

  it('forwards arguments and the exact knowledge API scope', async () => {
    mocks.listKnowledgeSources.mockResolvedValue([]);
    await getToolResult({ graphId: 'graph-1', nodeType: 'WORKBOOK' });
    expect(mocks.listKnowledgeSources).toHaveBeenCalledWith({
      graphId: 'graph-1',
      nodeType: 'WORKBOOK',
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('returns an empty source list as a successful result', async () => {
    mocks.listKnowledgeSources.mockResolvedValue([]);
    expect(await getJsonResult({ graphId: 'graph-1' })).toEqual({
      sources: [],
      mcp: { resultInfo: { returnedCount: 0, totalAvailable: 0, truncated: false } },
    });
  });

  it('preserves sources with completeness metadata', async () => {
    mocks.listKnowledgeSources.mockResolvedValue(sources);
    expect(await getJsonResult({ graphId: 'graph-1' })).toEqual({
      sources,
      mcp: { resultInfo: { returnedCount: 2, totalAvailable: 2, truncated: false } },
    });
  });

  it('applies the configured result limit and reports truncation', async () => {
    mocks.listKnowledgeSources.mockResolvedValue(sources);
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '1' }));
    expect(await getJsonResult({ graphId: 'graph-1' }, extra)).toEqual({
      sources: [sources[0]],
      mcp: { resultInfo: { returnedCount: 1, totalAvailable: 2, truncated: true } },
    });
  });

  it('funnels downstream errors through the tool error response', async () => {
    mocks.listKnowledgeSources.mockRejectedValue(new Error('knowledge unavailable'));
    const result = await getToolResult({ graphId: 'graph-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('knowledge unavailable');
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getListKnowledgeSourcesTool',
  );
  expect(factory, 'getListKnowledgeSourcesTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(
  args: any,
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, extra);
}

async function getJsonResult(args: any, extra = getMockRequestHandlerExtra()): Promise<unknown> {
  const result = await getToolResult(args, extra);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
