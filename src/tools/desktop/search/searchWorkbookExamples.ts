import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import path from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Corpus, searchDiffCorpusFormatted } from '../../../desktop/search/diffCorpus.js';
import { searchWorkbookExamples } from '../../../desktop/search/searchLibrary.js';
import { DATA_ROOT, DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

function loadCorpus(): Corpus | null {
  const corpusPath = process.env.CORPUS_PATH || path.join(DATA_ROOT, 'corpus.json');
  try {
    return JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;
  } catch {
    return null;
  }
}

let _corpus: Corpus | null | undefined;

function getCorpus(): Corpus | null {
  if (_corpus === undefined) _corpus = loadCorpus();
  return _corpus;
}

const paramsSchema = {
  feature: z.string().optional().describe('Feature tag; also fallback diff-corpus query.'),
  query: z.string().optional().describe('Diff-corpus query string.'),
  max_results: z.number().optional().describe('Max diff-corpus examples; default 5.'),
  source: z
    .enum(['curated', 'diff-corpus', 'both'])
    .optional()
    .default('curated')
    .describe('curated | diff-corpus | both'),
};

const title = 'Search Workbook Examples';
export const getSearchWorkbookExamplesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'search-workbook-examples',
    title,
    description:
      'Search curated workbook examples and/or the diff corpus. Default source=curated; use diff-corpus or both for XML diffs.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { feature, query, max_results = 5, source = 'curated' },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { feature, query, max_results, source },
        callback: async () => {
          const diffQuery = (query ?? feature ?? '').trim();

          if (source === 'diff-corpus' && !diffQuery) {
            return new Ok({
              text: 'source=diff-corpus requires `query`, or pass `feature` to use as the diff-corpus query string.',
              isError: true,
            });
          }

          const sections: string[] = [];

          if (source === 'curated' || source === 'both') {
            const curated = searchWorkbookExamples(feature || '');
            sections.push(`## Curated + indexed snippets\n${JSON.stringify(curated, null, 2)}`);
          }

          if (source === 'diff-corpus' || source === 'both') {
            const diffOut = searchDiffCorpusFormatted(getCorpus(), diffQuery, max_results);
            if (diffOut.isError && source === 'diff-corpus') {
              return new Ok({ text: diffOut.text, isError: true });
            }
            sections.push(`## Diff corpus (same as search-examples)\n${diffOut.text}`);
          }

          return new Ok({ text: sections.join('\n\n---\n\n'), isError: false });
        },
        getSuccessResult: (value) => ({
          isError: value.isError,
          content: [{ type: 'text', text: value.text }],
        }),
      });
    },
  });

  return tool;
};
