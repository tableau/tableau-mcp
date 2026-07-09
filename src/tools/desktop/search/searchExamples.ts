import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { readDataAsset } from '../../../desktop/assets.js';
import { Corpus, searchDiffCorpusFormatted } from '../../../desktop/search/diffCorpus.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

function loadCorpus(): Corpus | null {
  try {
    const raw = process.env.CORPUS_PATH
      ? readFileSync(process.env.CORPUS_PATH, 'utf8')
      : readDataAsset('corpus.json');
    return raw ? (JSON.parse(raw) as Corpus) : null;
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
  query: z.string().describe('Workbook change query.'),
  max_results: z.number().optional().describe('Max examples; default 5.'),
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
      destructiveHint: false,
      idempotentHint: true,
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
