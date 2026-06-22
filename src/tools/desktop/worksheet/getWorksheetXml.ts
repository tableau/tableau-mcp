import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { getWorksheetXml } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  worksheetName: z.string().describe('Name of the worksheet to get (must exist in the workbook).'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe(
      'file: write cache and return path (default). inline: return worksheet XML in the tool result.',
    ),
};

type InlineResult = {
  worksheetXml: string;
};

type FileResult = {
  file: string;
  instructions: string;
};

type GetWorksheetXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Worksheet XML';
export const getGetWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetXmlTool = new DesktopTool({
    server,
    name: 'get-worksheet-xml',
    title,
    description: [
      'Gets the XML for a specific worksheet.',
      'Default mode writes a cache file and returns the path (recommended).',
      'Use mode=inline to return XML in the response.',
      '⚠️ PREFERRED APPROACH: Use the field manipulation tools (add-field-to-*, etc.) instead of directly editing XML.',
      "Only edit XML directly as a last resort when the higher-level tools don't support your use case.",
      'Use apply-worksheet to apply changes.',
      'IMPORTANT: This only works for existing worksheets — use list-worksheets to see available worksheets.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false, // A new cache file is created for each tool call
    },
    callback: async ({ session, worksheetName, mode }, extra): Promise<CallToolResult> => {
      return await getWorksheetXmlTool.logAndExecute<GetWorksheetXmlToolResult>({
        extra,
        args: { session, worksheetName, mode },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const result = await getWorksheetXml({ worksheetName, executor, signal: extra.signal });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          const worksheetXml = result.value;
          const bytes = new TextEncoder().encode(worksheetXml).byteLength;

          switch (mode) {
            case 'inline': {
              return new Ok({
                message: `Worksheet XML returned inline (${bytes} bytes)`,
                worksheetXml,
              });
            }
            case 'file': {
              const safeName = worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
              const cacheFile = new DesktopCache().getCacheFilePath({
                prefix: `worksheet-${safeName}`,
              });
              writeFileSync(cacheFile, worksheetXml, 'utf-8');
              log({
                message: `Saved worksheet XML to cache file: ${cacheFile}`,
                level: 'info',
                logger: 'tool',
                data: {
                  file: cacheFile,
                  size: bytes,
                },
              });

              return Ok({
                message: `Worksheet "${worksheetName}" saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary('worksheet', worksheetXml)}`,
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

  return getWorksheetXmlTool;
};
