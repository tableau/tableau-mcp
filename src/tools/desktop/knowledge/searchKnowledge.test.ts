import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSearchKnowledgeTool } from './searchKnowledge.js';

vi.mock('../../../desktop/knowledge/index.js');

import { searchKnowledgeWithFallback } from '../../../desktop/knowledge/index.js';

const TOP_HIT = {
  uri: 'expertise://tableau/strategy/viz-design/chart-selection',
  slug: 'strategy/viz-design/chart-selection',
  title: 'Chart Selection',
  score: 0.9,
  snippet: 'Choose a chart from the analytical question.',
  match: 'keyword' as const,
  mustReadUri: 'expertise://tableau/strategy/viz-design/chart-selection',
  instruction: 'snippet is not the module — read this URI before authoring',
};

describe('searchKnowledgeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchKnowledgeWithFallback).mockReturnValue({ hits: [TOP_HIT] });
  });

  it('tells callers that search snippets require a targeted read', async () => {
    const tool = getSearchKnowledgeTool(new DesktopMcpServer());

    expect(await Provider.from(tool.description)).toContain('read mustReadUri');
  });

  it('returns the top hit read requirement', async () => {
    const result = await getResult();

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).hits[0]).toMatchObject({
      mustReadUri: TOP_HIT.uri,
      instruction: TOP_HIT.instruction,
    });
  });

  it('returns an explicit asset-root error when the search index is empty', async () => {
    vi.mocked(searchKnowledgeWithFallback).mockImplementation(() => {
      throw new Error(
        'Knowledge corpus is empty; expected assets under /app/resources/desktop/knowledge',
      );
    });

    const result = await getResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('/app/resources/desktop/knowledge');
  });
});

async function getResult(): Promise<CallToolResult> {
  const tool = getSearchKnowledgeTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { query: 'pie chart of countries', limit: 3 },
    getMockRequestHandlerExtra(),
  );
}
