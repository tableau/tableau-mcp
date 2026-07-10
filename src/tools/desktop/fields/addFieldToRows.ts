import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { addFieldToRows } from '../../../desktop/metadata/index.js';
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
  worksheetFile: z.string().describe('Worksheet XML cache.'),
  columnRef: z.string().describe('Column ref.'),
  index: z.number().optional().describe('0-based insert position.'),
  workbookFile: z.string().optional().describe('Workbook cache for datasource caption.'),
};

const title = 'Add Field to Rows Shelf';
export const getAddFieldToRowsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const addFieldToRowsTool = new DesktopTool({
    server,
    name: 'add-field-to-rows',
    title,
    description: [
      'Add a field to the rows shelf (mutates worksheet cache; adds datasource dependency if missing).',
      'Workflow: get-worksheet-xml → this tool → apply-worksheet.',
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
      return await addFieldToRowsTool.logAndExecute({
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
            modifiedXml = addFieldToRows(worksheetXml, columnRef, index, workbookXml);
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
            message: `Successfully added field to rows shelf. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return addFieldToRowsTool;
};
