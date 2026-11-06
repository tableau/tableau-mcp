import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getSearchExpertiseTool } from './searchExpertise.js';

vi.mock('../../../../desktop/expertise/index.js');

import { searchExpertiseWithFallback } from '../../../../desktop/expertise/index.js';
import * as loggerModule from '../../../../logging/logger.js';

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

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('searchExpertiseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchExpertiseWithFallback).mockReturnValue({ hits: [TOP_HIT] });
  });

  it('tells callers to skip the targeted read when the top body is present', async () => {
    const tool = getSearchExpertiseTool(new DesktopMcpServer());
    const description = await Provider.from(tool.description);

    expect(description).toContain(
      'When topHitBody is present, it is the full module; no follow-up read is needed.',
    );
    expect(description).not.toContain('read-expertise-resource');
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
    vi.mocked(searchExpertiseWithFallback).mockImplementation(() => {
      throw new Error(
        'Expertise corpus is empty; expected assets under /app/resources/desktop/expertise',
      );
    });

    const result = await getResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('/app/resources/desktop/expertise');
  });
});

async function getResult(): Promise<CallToolResult> {
  const tool = getSearchExpertiseTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { query: 'pie chart of countries', limit: 3 },
    getMockRequestHandlerExtra(),
  );
}
