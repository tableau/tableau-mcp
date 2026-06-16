import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import path from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Corpus, searchDiffCorpusFormatted } from '../../../desktop/search/diffCorpus.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

function loadCorpus(): Corpus | null {
  const corpusPath = process.env.CORPUS_PATH || path.join(process.cwd(), 'data', 'corpus.json');
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
  query: z
    .string()
    .describe(
      "What you want to do (e.g., 'add field to view', 'create dashboard', 'bar chart', 'filter')",
    ),
  max_results: z.number().optional().describe('Maximum number of examples to return (default 5)'),
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
      "Search for before/after examples of workbook changes. Returns XML diffs at multiple granularity levels: worksheet-level diffs (5-20 lines, focused on one sheet), dashboard-level diffs, or full workbook diffs. Worksheet/dashboard-level diffs are preferred when available as they're easier to understand and apply. Search for: 'worksheet', 'dashboard', 'field', 'filter', 'chart', 'map', 'color', 'sort', etc.",
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
