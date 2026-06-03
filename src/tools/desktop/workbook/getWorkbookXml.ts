import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe(
      'file: write cache and return path (default). inline: return full workbook XML in the tool result.',
    ),
};

type InlineResult = {
  workbookXml: string;
};

type FileResult = {
  file: string;
  instructions: string;
};
type GetWorkbookXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Workbook XML';
export const getGetWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorkbookXmlTool = new DesktopTool({
    server,
    name: 'get-workbook-xml',
    title,
    description: [
      'Gets the current workbook.',
      'Default mode writes a cache file and returns the path (recommended for large workbooks).',
      'Use mode=inline to return XML in the response.',
      '⚠️ PREFERRED APPROACH: Use the field manipulation tools (add-field-to-*, etc.) instead of directly editing XML.',
      'To create new worksheets or dashboards, use batch-create-and-cache-sheets.',
      "Only edit XML directly as a last resort when the higher-level tools don't support your use case.",
      'Use apply-workbook to apply changes.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false, // A new cache file is created for each tool call
      idempotentHint: false, // A new cache file is created for each tool call
    },
    callback: async ({ session, mode }, extra): Promise<CallToolResult> => {
      return await getWorkbookXmlTool.logAndExecute<GetWorkbookXmlToolResult>({
        extra,
        args: { session, mode },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const result = await getWorkbookXml({ executor, signal: extra.signal });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const workbookXml = result.value;
          const bytes = new TextEncoder().encode(workbookXml).byteLength;
          switch (mode) {
            case 'inline': {
              return new Ok({
                message: `Workbook XML returned inline (${bytes} bytes)`,
                workbookXml,
              });
            }
            case 'file': {
              // Save to cache file
              const cacheFile = new DesktopCache().getCacheFilePath({ prefix: 'workbook' });
              writeFileSync(cacheFile, workbookXml, 'utf-8');
              log({
                message: `Saved workbook XML to cache file: ${cacheFile}`,
                level: 'info',
                logger: 'tool',
                data: {
                  file: cacheFile,
                  size: bytes,
                },
              });

              return Ok({
                message: `Workbook saved to cache file (${bytes} bytes)`,
                file: cacheFile,
                instructions:
                  'Use this file path with modification tools instead of passing XML directly.',
              });
            }
          }
        },
      });
    },
  });

  return getWorkbookXmlTool;
};
