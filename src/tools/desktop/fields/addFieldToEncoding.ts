import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { addFieldToEncoding } from '../../../desktop/metadata/index.js';
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
  worksheetFile: z.string().describe('Worksheet XML cache file.'),
  encodingType: z
    .enum(['color', 'size', 'lod', 'detail', 'text', 'tooltip', 'path', 'angle'])
    .describe("Encoding type; use 'text' for labels."),
  columnRef: z.string().describe('Column reference.'),
  index: z.number().optional().describe('Optional 0-based insert position.'),
  workbookFile: z
    .string()
    .optional()
    .describe('Optional workbook cache file for datasource caption.'),
};

const title = 'Add Field to Encoding';
export const getAddFieldToEncodingTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const addFieldToEncodingTool = new DesktopTool({
    server,
    name: 'add-field-to-encoding',
    title,
    description: [
      'Add a field to an encoding (mutates worksheet cache; adds datasource dependency if missing).',
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
      { worksheetFile, encodingType, columnRef, index, workbookFile },
      extra,
    ): Promise<CallToolResult> => {
      return await addFieldToEncodingTool.logAndExecute({
        extra,
        args: { worksheetFile, encodingType, columnRef, index, workbookFile },
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
            modifiedXml = addFieldToEncoding(
              worksheetXml,
              encodingType,
              columnRef,
              index,
              workbookXml,
            );
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
            message: `Successfully added field to ${encodingType} encoding. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return addFieldToEncodingTool;
};
