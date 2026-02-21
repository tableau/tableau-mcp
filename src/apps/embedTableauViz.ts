import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import z from 'zod';

import { Server } from '../server';
import { AppTool } from './appTool';

const paramsSchema = {
  workbookUrl: z.string(),
};

export const getEmbedTableauVizTool = (server: Server): AppTool<typeof paramsSchema> => {
  const embedTableauVizTool = new AppTool({
    server,
    name: 'embed-tableau-viz',
    title: 'Embed Tableau Viz',
    description: 'Embed a Tableau viz in a chat window.',
    paramsSchema,
    sandboxCapabilities: {
      csp: {
        connectDomains: ['https://*.tableau.com'],
        resourceDomains: ['https://*.tableau.com'],
        frameDomains: ['https://*.tableau.com'],
      },
    },
    callback: async ({ workbookUrl }, extra): Promise<CallToolResult> => {
      return await embedTableauVizTool.logAndExecute<string>({
        extra,
        args: { workbookUrl },
        callback: async () => {
          return new Ok(workbookUrl);
        },
      });
    },
  });

  return embedTableauVizTool;
};
