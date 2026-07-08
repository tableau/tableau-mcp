import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import path from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Corpus, searchDiffCorpusFormatted } from '../../../desktop/search/diffCorpus.js';
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
  query: z.string().describe('What workbook change you want to do.'),
  max_results: z.number().optional().describe('Maximum examples; default 5.'),
};

const title = 'Search Workbook Transformation Examples';
export const getSearchExamplesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'search-examples',
    title,
    description:
      'Search before/after workbook-change examples. Returns worksheet, dashboard, or workbook XML diffs; prefer focused diffs when available.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ query, max_results = 5 }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { query, max_results },
        callback: async () => {
          const out = searchDiffCorpusFormatted(getCorpus(), query, max_results);
          return new Ok({ text: out.text, isError: out.isError ?? false });
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
