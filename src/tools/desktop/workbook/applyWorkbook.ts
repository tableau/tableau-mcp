import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Session ID from list-instances.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file reads workbookFile; inline uses workbookXml.'),
  workbookFile: z.string().optional().describe('Modified workbook cache file for mode=file.'),
  workbookXml: z.string().optional().describe('Full workbook XML for mode=inline.'),
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
      'Apply modified workbook XML to Tableau (mutating). mode=file is default; mode=inline is for small XML.',
      'See expertise://tableau/tableau-tactics/data/datasources before editing datasource XML.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // writes cache files and updates workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false, // each call creates a new cache file
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

          const executor = await extra.getExecutor(session);
          const result = await loadWorkbookXml({
            xml: workbookXml,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Applies are never rejected on size; if an inline payload was over the cap, just
          // point at the cheaper file-mode workflow for next time (the token win is on GET).
          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(workbookXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

          return new Ok({
            message: `Successfully applied workbook XML. The workbook has been updated.${note}`,
          });
        },
      });
    },
  });

  return applyWorkbookTool;
};
