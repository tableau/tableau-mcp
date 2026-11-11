import { Corpus, searchDiffCorpusFormatted } from './diffCorpus.js';

const CORPUS: Corpus = {
  version: '1',
  description: 'test',
  example_count: 2,
  examples: [
    {
      id: '1',
      title: 'Add a categorical filter',
      description: 'Filter by Category',
      user_input: 'add filter',
      tags: ['filter'],
      complexity: 'simple',
      diff_lines: 3,
      timestamp: '',
      diff: '+ filter',
    },
    {
      id: '2',
      title: 'Create a bar chart',
      description: 'Bar mark',
      user_input: 'bar chart',
      tags: ['chart', 'bar'],
      complexity: 'simple',
      diff_lines: 5,
      timestamp: '',
      diff: '+ bar',
    },
  ],
};

describe('searchDiffCorpusFormatted', () => {
  it('returns isError when the corpus is unavailable', () => {
    const r = searchDiffCorpusFormatted(null, 'filter', 5);
    expect(r.isError).toBe(true);
  });

  it('rejects an empty query instead of matching the whole corpus', () => {
    const r = searchDiffCorpusFormatted(CORPUS, '', 5);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('non-empty query');
    expect(r.text).not.toContain('Found 2 example(s)');
  });

  it('rejects a whitespace-only query', () => {
    const r = searchDiffCorpusFormatted(CORPUS, '   ', 5);
    expect(r.isError).toBe(true);
  });

  it('matches by title/tag for a real query', () => {
    const r = searchDiffCorpusFormatted(CORPUS, 'filter', 5);
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Add a categorical filter');
    expect(r.text).toContain('Found 1 example(s)');
  });
});
