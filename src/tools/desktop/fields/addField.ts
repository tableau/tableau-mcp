import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  addFieldToCols,
  addFieldToEncoding,
  addFieldToRows,
} from '../../../desktop/metadata/index.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

/** Encoding channels a field can be placed on. */
const ENCODING_TYPES = [
  'color',
  'size',
  'lod',
  'detail',
  'text',
  'tooltip',
  'path',
  'angle',
] as const;
/** Shelf / encoding a field can be added to. */
const FIELD_TARGETS = ['rows', 'cols', 'encoding'] as const;

const paramsSchema = {
  session: z.string().describe('Session ID.'),
  worksheetFile: z.string().describe('Worksheet cache file.'),
  target: z.enum(FIELD_TARGETS).describe('Destination: rows=Rows, cols=Columns, or encoding.'),
  columnRef: z.string().describe('Column reference.'),
  encodingType: z
    .enum(ENCODING_TYPES)
    .optional()
    .describe("Encoding channel ('text'=labels); required iff target=encoding."),
  index: z.number().optional().describe('0-based insert position.'),
  workbookFile: z.string().optional().describe('Workbook cache file for caption.'),
};

const title = 'Add Field';
export const getAddFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const addFieldTool = new DesktopTool({
    server,
    name: 'add-field',
    title,
    description:
      'Add a field to Rows, Columns, or an encoding; mutates cache. Apply with apply-worksheet.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetFile, target, columnRef, encodingType, index, workbookFile },
      extra,
    ): Promise<CallToolResult> => {
      return await addFieldTool.logAndExecute({
        extra,
        args: { session, worksheetFile, target, columnRef, encodingType, index, workbookFile },
        callback: async () => {
          if (!existsSync(worksheetFile)) {
            return new FileNotFoundError(worksheetFile).toErr();
          }

          // encodingType is conditionally required — enforced here (not in the JSON Schema) so
          // the schema stays flat and host-portable.
          if (target === 'encoding' && !encodingType) {
            return new ArgsValidationError(
              `encodingType is required when target=encoding. Provide one of: ${ENCODING_TYPES.join(', ')}.`,
            ).toErr();
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
          let placement: string;
          try {
            switch (target) {
              case 'rows':
                modifiedXml = addFieldToRows(worksheetXml, columnRef, index, workbookXml);
                placement = 'Rows shelf';
                break;
              case 'cols':
                modifiedXml = addFieldToCols(worksheetXml, columnRef, index, workbookXml);
                placement = 'Columns shelf';
                break;
              case 'encoding':
                modifiedXml = addFieldToEncoding(
                  worksheetXml,
                  encodingType!,
                  columnRef,
                  index,
                  workbookXml,
                );
                placement = `${encodingType} encoding`;
                break;
              default: {
                const _exhaustive: never = target;
                throw new Error(`Unknown target: ${String(_exhaustive)}`);
              }
            }
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
            writeSidecar(worksheetFile, session);
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          return new Ok({
            message: `Successfully added field to ${placement}. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return addFieldTool;
};
