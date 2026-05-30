import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { getWorkbookXml } from '../../../desktop/commands/workbookCommands.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file: read workbookFile from disk (default). inline: use workbookXml string.'),
  workbookFile: z
    .string()
    .optional()
    .describe('Path to the cache file containing the modified workbook (required when mode=file)'),
  workbookXml: z
    .string()
    .optional()
    .describe('Full workbook TWB XML string (required when mode=inline)'),
};

const title = 'Apply Workbook';
export const getApplyWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyWorkbookTool = new DesktopTool({
    server,
    name: 'apply-workbook',
    title,
    description: [
      'Apply modified workbook back to Tableau.',
      'Default mode reads from a cache file (recommended).',
      'Use mode=inline with workbook_xml for small workbooks (same behavior as tableau-load-metadata-xml).',
      'See expertise://tableau/tableau-tactics/data/datasources before editing datasource XML (object-graph, relationships, connections).',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, mode, workbookFile, workbookXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorkbookTool.logAndExecute({
        extra,
        args: { session, mode, workbookFile, workbookXml },
        callback: async () => {
          switch (mode) {
            case 'inline': {
              if (!workbookXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, a non-empty workbook TWB XML string is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!workbookFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty workbook file path is required.',
                    'The path can be determined using any of the tools that get or modify workbook XML.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(workbookFile)) {
                return new WorkbookNotFoundError(
                  [
                    `Cached workbook file not found: ${workbookFile}`,
                    'Provide a path determined by any of the tools that get or modify workbook XML.',
                  ].join(' '),
                ).toErr();
              }

              try {
                workbookXml = readFileSync(workbookFile, 'utf-8');
              } catch (error) {
                return new FileReadError(error).toErr();
              }
              break;
            }
          }
        },
      });
    },
  });

  return applyWorkbookTool;
};
