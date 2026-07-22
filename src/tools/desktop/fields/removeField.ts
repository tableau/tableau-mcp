import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  removeFieldFromCols,
  removeFieldFromEncoding,
  removeFieldFromRows,
} from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
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
import { fetchAndCacheWorksheet } from './worksheetCache.js';

/** Encoding channels a field can be removed from. */
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
/** Shelf / encoding a field can be removed from. */
const FIELD_TARGETS = ['rows', 'cols', 'encoding'] as const;

const paramsSchema = {
  session: z.string().optional().describe('Desktop session; omit if one.'),
  worksheetName: z
    .string()
    .optional()
    .describe('Sheet to edit (fetched fresh); or pass worksheetFile to stack edits.'),
  worksheetFile: z
    .string()
    .optional()
    .describe('Cached sheet path from a prior edit; stacks edits.'),
  target: z.enum(FIELD_TARGETS).describe('Placement shelf.'),
  columnRef: z.string().describe('Field to remove.'),
  encodingType: z.enum(ENCODING_TYPES).optional().describe('Required when target=encoding.'),
};

const title = 'Remove Field';
export const getRemoveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const removeFieldTool = new DesktopTool({
    server,
    name: 'remove-field',
    title,
    description: 'Remove a field from a shelf (rows/cols/encoding); counterpart to add-field.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetName, worksheetFile, target, columnRef, encodingType },
      extra,
    ): Promise<CallToolResult> => {
      return await removeFieldTool.logAndExecute({
        extra,
        args: { session, worksheetName, worksheetFile, target, columnRef, encodingType },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          if (!worksheetFile?.trim() && !worksheetName?.trim()) {
            return new ArgsValidationError(
              'Provide either worksheetName (to edit an existing sheet) or worksheetFile (a cached path).',
            ).toErr();
          }

          // Name-based path: always fetch fresh and mint a new cache file. Follow-up
          // add-field/remove-field calls should pass the returned worksheetFile to stack edits.
          if (!worksheetFile?.trim()) {
            const minted = await fetchAndCacheWorksheet({
              worksheetName: worksheetName!.trim(),
              resolvedSession,
              extra,
            });
            if (minted.isErr()) {
              return minted.error.toErr();
            }
            worksheetFile = minted.value;
          }

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

          let modifiedXml: string;
          let placement: string;
          try {
            switch (target) {
              case 'rows':
                modifiedXml = removeFieldFromRows(worksheetXml, columnRef);
                placement = 'Rows shelf';
                break;
              case 'cols':
                modifiedXml = removeFieldFromCols(worksheetXml, columnRef);
                placement = 'Columns shelf';
                break;
              case 'encoding':
                modifiedXml = removeFieldFromEncoding(worksheetXml, encodingType!, columnRef);
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
            writeSidecar(worksheetFile, resolvedSession);
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          return new Ok({
            message: `Successfully removed field from ${placement}. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return removeFieldTool;
};
