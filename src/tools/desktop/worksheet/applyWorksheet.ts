import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
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
  session: z.string().describe('Session ID from list-instances.'),
  worksheetName: z.string().describe('Name of the worksheet to update (must already exist).'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file reads worksheetFile; inline uses worksheetXml.'),
  worksheetFile: z.string().optional().describe('Modified worksheet cache file for mode=file.'),
  worksheetXml: z.string().optional().describe('Worksheet XML for mode=inline.'),
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
      'Apply modified worksheet XML to Tableau (mutating). mode=file is default; mode=inline is for small XML.',
      'IMPORTANT: can only UPDATE an existing worksheet, not create one — use apply-workbook to create.',
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

          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(worksheetXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

          return new Ok({
            message: `Successfully applied worksheet XML for "${worksheetName}". The worksheet has been updated.${note}`,
          });
        },
      });
    },
  });

  return applyWorksheetTool;
};
