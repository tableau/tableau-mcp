import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as diffCorpusModule from '../../../desktop/search/diffCorpus.js';
import * as searchLibrary from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSearchWorkbookExamplesTool } from './searchWorkbookExamples.js';

vi.mock('../../../desktop/search/diffCorpus.js');
vi.mock('../../../desktop/search/searchLibrary.js');

const CURATED_RESULT = {
  examples: [{ name: 'filter-categorical', description: 'Categorical filter', features: [] }],
  twbExamples: [],
  total: 1,
  twbTotal: 0,
};

describe('searchWorkbookExamplesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getSearchWorkbookExamplesTool(new DesktopMcpServer());
    expect(tool.name).toBe('search-workbook-examples');
    expect(tool.description).toContain('curated examples');
    expect(tool.paramsSchema).toMatchObject({
      feature: expect.any(Object),
      query: expect.any(Object),
      max_results: expect.any(Object),
      source: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should use curated source by default and call searchWorkbookExamples', async () => {
    vi.mocked(searchLibrary.searchWorkbookExamples).mockReturnValue(CURATED_RESULT);

    const result = await getResult({ feature: 'filter' });

    expect(result.isError).toBeFalsy();
    expect(searchLibrary.searchWorkbookExamples).toHaveBeenCalledWith('filter');
    expect(diffCorpusModule.searchDiffCorpusFormatted).not.toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Curated + indexed snippets');
  });

  it('should use diff-corpus source and call searchDiffCorpusFormatted', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({
      text: 'Found 1 example(s) matching "sort".',
    });

    const result = await getResult({ query: 'sort', source: 'diff-corpus' });

    expect(result.isError).toBeFalsy();
    expect(searchLibrary.searchWorkbookExamples).not.toHaveBeenCalled();
    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalledWith(
      expect.anything(),
      'sort',
      5,
    );
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Diff corpus');
  });

  it('should call both sources when source=both', async () => {
    vi.mocked(searchLibrary.searchWorkbookExamples).mockReturnValue(CURATED_RESULT);
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({ text: 'diff results' });

    const result = await getResult({ feature: 'sort', source: 'both' });

    expect(searchLibrary.searchWorkbookExamples).toHaveBeenCalled();
    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Curated + indexed snippets');
    expect(result.content[0].text).toContain('Diff corpus');
  });

  it('should return isError=true when source=diff-corpus with no query or feature', async () => {
    const result = await getResult({ source: 'diff-corpus' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires `query`');
  });

  it('should use feature as fallback diff-corpus query when query is omitted', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({ text: 'ok' });

    await getResult({ feature: 'dashboard', source: 'diff-corpus' });

    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalledWith(
      expect.anything(),
      'dashboard',
      5,
    );
  });

  it('should propagate isError from diff-corpus when source=diff-corpus', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({
      text: 'Corpus unavailable.',
      isError: true,
    });

    const result = await getResult({ query: 'anything', source: 'diff-corpus' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Corpus unavailable.');
  });

  it('should pass max_results to searchDiffCorpusFormatted', async () => {
    vi.mocked(diffCorpusModule.searchDiffCorpusFormatted).mockReturnValue({ text: 'ok' });

    await getResult({ query: 'filter', source: 'diff-corpus', max_results: 10 });

    expect(diffCorpusModule.searchDiffCorpusFormatted).toHaveBeenCalledWith(
      expect.anything(),
      'filter',
      10,
    );
  });
});

async function getResult({
  feature,
  query,
  max_results,
  source,
}: {
  feature?: string;
  query?: string;
  max_results?: number;
  source?: 'curated' | 'diff-corpus' | 'both';
}): Promise<CallToolResult> {
  const tool = getSearchWorkbookExamplesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { feature, query, max_results, source: source ?? 'curated' },
    getMockRequestHandlerExtra(),
  );
}
