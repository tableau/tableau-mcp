import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as diffCorpusModule from '../../../desktop/search/diffCorpus.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSearchExamplesTool } from './searchExamples.js';

vi.mock('../../../desktop/search/diffCorpus.js');

describe('searchExamplesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getSearchExamplesTool(new DesktopMcpServer());
    expect(tool.name).toBe('search-examples');
    expect(tool.description).toBe('Search workbook-change examples.');
    expect(tool.paramsSchema).toMatchObject({
      query: expect.any(Object),
      max_results: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return success with matched examples text', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({
      text: 'Found 2 example(s) matching "filter".',
    });

    const result = await getResult({ query: 'filter' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Found 2 example(s)');
  });

  it('should propagate isError=true when corpus returns an error', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({
      text: 'Example corpus is not available.',
      isError: true,
    });

    const result = await getResult({ query: 'anything' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('corpus is not available');
  });

  it('should pass query and max_results to searchDiffCorpusFormatted', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({ text: 'ok' });

    await getResult({ query: 'sort', max_results: 3 });

    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalledWith(
      expect.anything(),
      'sort',
      3,
    );
  });

  it('should default max_results to 5 when not provided', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({ text: 'ok' });

    await getResult({ query: 'dashboard' });

    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalledWith(
      expect.anything(),
      'dashboard',
      5,
    );
  });
});

async function getResult({
  query,
  max_results,
}: {
  query: string;
  max_results?: number;
}): Promise<CallToolResult> {
  const tool = getSearchExamplesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ query, max_results }, getMockRequestHandlerExtra());
}
