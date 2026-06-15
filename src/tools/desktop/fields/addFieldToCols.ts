import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { addFieldToCols } from '../../../desktop/metadata/index.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  worksheetFile: z
    .string()
    .describe(
      'Path to the cache file containing worksheet XML (from get-worksheet-xml or a previous modification tool).',
    ),
  columnRef: z
    .string()
    .describe(
      "Column reference — format: [ds].[derivation:LocalName:typePivot] (e.g. '[Sample - Superstore].[sum:Profit:qk]').",
    ),
  index: z.number().optional().describe('Optional position (0-based). If omitted, appends to end.'),
  workbookFile: z
    .string()
    .optional()
    .describe(
      'Optional path to workbook cache file (from get-workbook-xml). Provides datasource caption for better compatibility.',
    ),
};

const title = 'Add Field to Columns Shelf';
export const getAddFieldToColsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const addFieldToColsTool = new DesktopTool({
    server,
    name: 'add-field-to-cols',
    title,
    description: [
      'Add a field to the columns shelf on a worksheet.',
      'Reads from and writes to the worksheet cache file.',
      'Workflow: get-workbook-xml → list-available-fields → get-worksheet-xml → this tool → apply-worksheet.',
      'Automatically adds the column definition to datasource-dependencies if missing.',
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
      { worksheetFile, columnRef, index, workbookFile },
      extra,
    ): Promise<CallToolResult> => {
      return await addFieldToColsTool.logAndExecute({
        extra,
        args: { worksheetFile, columnRef, index, workbookFile },
        callback: async () => {
          if (!existsSync(worksheetFile)) {
            return new FileNotFoundError(worksheetFile).toErr();
          }

          let worksheetXml: string;
          try {
            worksheetXml = readFileSync(worksheetFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          let workbookXml: string | undefined;
          if (workbookFile && existsSync(workbookFile)) {
            try {
              workbookXml = readFileSync(workbookFile, 'utf-8');
            } catch {
              // Non-fatal — proceed without workbook context
            }
          }

          let modifiedXml: string;
          try {
            modifiedXml = addFieldToCols(worksheetXml, columnRef, index, workbookXml);
          } catch (error) {
            return new XmlModificationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }

          const issues = wellFormedXmlRule.validate(modifiedXml);
          const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
          if (errors.length > 0) {
            return new XmlValidationError(errors).toErr();
          }

          try {
            writeFileSync(worksheetFile, modifiedXml, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          return new Ok({
            message: `Successfully added field to columns shelf. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return addFieldToColsTool;
};
