import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  WorksheetNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  worksheetName: z.string().describe('Name of the worksheet to update (must already exist).'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file: read worksheetFile from disk (default). inline: use worksheetXml string.'),
  worksheetFile: z
    .string()
    .optional()
    .describe('Path to the cache file containing the modified worksheet (required when mode=file)'),
  worksheetXml: z
    .string()
    .optional()
    .describe('Worksheet TWB XML string (required when mode=inline)'),
};

const title = 'Apply Worksheet';
export const getApplyWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description: [
      'Apply modified worksheet XML back to Tableau.',
      'Default mode reads from a cache file (recommended).',
      'Use mode=inline with worksheetXml for small worksheets.',
      'IMPORTANT: Can only update existing worksheets, cannot create new ones.',
      'Use apply-workbook to create new worksheets.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetName, mode, worksheetFile, worksheetXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: { session, worksheetName, mode, worksheetFile, worksheetXml },
        callback: async () => {
          switch (mode) {
            case 'inline': {
              if (!worksheetXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, a non-empty worksheet XML string is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!worksheetFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty worksheet file path is required.',
                    'The path can be determined using get-worksheet-xml.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(worksheetFile)) {
                return new WorksheetNotFoundError(
                  [
                    `Cached worksheet file not found: ${worksheetFile}`,
                    'Provide a path determined by get-worksheet-xml.',
                  ].join(' '),
                ).toErr();
              }

              try {
                worksheetXml = readFileSync(worksheetFile, 'utf-8');
              } catch (error) {
                return new FileReadError(error).toErr();
              }
              break;
            }
          }

          const executor = await extra.getExecutor(session);
          const result = await loadWorksheetXml({
            worksheetName,
            xml: worksheetXml,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          return new Ok({
            message: `Successfully applied worksheet XML for "${worksheetName}". The worksheet has been updated.`,
          });
        },
      });
    },
  });

  return applyWorksheetTool;
};
