import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import levenshtein from 'fast-levenshtein';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { parseDatasourceQualifiedColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { parseShelfValue } from '../../../desktop/metadata/fields.js';
import {
  addFieldToCols,
  addFieldToEncoding,
  addFieldToRows,
  listAvailableFields,
} from '../../../desktop/metadata/index.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
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

/** One worked column ref, used in both the schema description and the rejection message. */
const COLUMN_REF_EXAMPLE = '[Sample - Superstore].[sum:Sales:qk]';
const MAX_COLUMN_SUGGESTIONS = 3;

/**
 * Nearest real column refs for a value that is not a column ref at all. The schema
 * said only "Field.", so the agent sent bare names; restating the grammar back at it
 * did not help. Name the refs that exist instead.
 */
function nearestColumnRefs(columnRef: string, workbookXml: string | undefined): string[] {
  if (!workbookXml) {
    return [];
  }
  let fields: ReturnType<typeof listAvailableFields>;
  try {
    fields = listAvailableFields(workbookXml);
  } catch {
    return [];
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    return [];
  }
  const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = normalize(columnRef);
  return fields
    .map((field) => ({
      ref: field.column_ref,
      distance: levenshtein.get(needle, normalize(field.columnName ?? field.column_ref)),
    }))
    .sort((a, b) => a.distance - b.distance || a.ref.localeCompare(b.ref))
    .slice(0, MAX_COLUMN_SUGGESTIONS)
    .map(({ ref }) => ref);
}

function columnRefRejection(columnRef: string, workbookXml: string | undefined): string {
  const suggestions = nearestColumnRefs(columnRef, workbookXml);
  const next =
    suggestions.length > 0
      ? `Did you mean: ${suggestions.join(', ')}?`
      : 'Call resolve-field with the field name to get the exact ref, or list-available-fields for every ref in the workbook.';
  return `columnRef "${columnRef}" is not a column reference. Expected [Datasource].[derivation:Column:type], e.g. ${COLUMN_REF_EXAMPLE}. ${next}`;
}

const paramsSchema = {
  session: z.string().optional().describe('Session.'),
  worksheetName: z.string().optional().describe('Fetched fresh.'),
  worksheetFile: z.string().optional().describe('Cache path; stacks edits.'),
  target: z.enum(FIELD_TARGETS).describe('Shelf.'),
  columnRef: z
    .string()
    .describe(
      `Exact ref [Datasource].[derivation:Column:type], e.g. ${COLUMN_REF_EXAMPLE}. Not a bare name; get it from resolve-field.`,
    ),
  encodingType: z.enum(ENCODING_TYPES).optional().describe('For encoding target.'),
  index: z.number().optional().describe('Position.'),
  workbookFile: z.string().optional().describe('Workbook.'),
};

const title = 'Add Field';
export const getAddFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const addFieldTool = new DesktopTool({
    server,
    name: 'add-field',
    title,
    description:
      'Place a field on a shelf (rows/cols/encoding); the manual path when no template binds.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        worksheetName,
        worksheetFile,
        target,
        columnRef,
        encodingType,
        index,
        workbookFile,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await addFieldTool.logAndExecute({
        extra,
        args: {
          session,
          worksheetName,
          worksheetFile,
          target,
          columnRef,
          encodingType,
          index,
          workbookFile,
        },
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

          // Name-based path: no cache file yet — fetch the sheet fragment and mint one. The
          // returned worksheetFile lets follow-up add-field/remove-field calls accumulate edits
          // on the same cache before a single apply-worksheet (get-once, edit-many, apply-once).
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

          let workbookXml: string | undefined;
          if (workbookFile && existsSync(workbookFile)) {
            try {
              workbookXml = readFileSync(workbookFile, 'utf-8');
            } catch {
              // Non-fatal — proceed without workbook context
            }
          }

          if (index !== undefined) {
            let existingLength: number;
            try {
              existingLength = getCurrentPlacementLength(worksheetXml, target, encodingType);
            } catch (error) {
              return new XmlModificationError(
                error instanceof Error ? error.message : String(error),
              ).toErr();
            }

            if (!Number.isInteger(index) || index < 0 || index > existingLength) {
              return new ArgsValidationError(
                `index must be an integer in the range 0..${existingLength} for ${target}.`,
              ).toErr();
            }
          }

          // Checked here, not deeper down, because this is the only layer that can see
          // the workbook and name the refs that DO exist.
          if (!parseDatasourceQualifiedColumnRef(columnRef)) {
            return new ArgsValidationError(columnRefRejection(columnRef, workbookXml)).toErr();
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
            writeSidecar(worksheetFile, resolvedSession);
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

function getCurrentPlacementLength(
  worksheetXml: string,
  target: (typeof FIELD_TARGETS)[number],
  encodingType?: (typeof ENCODING_TYPES)[number],
): number {
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);
  if (!worksheet) {
    throw new Error('No worksheet found in XML');
  }

  if (target === 'rows' || target === 'cols') {
    return parseShelfValue(worksheet.table?.[target]).length;
  }

  const canonicalEncodingType = encodingType === 'detail' ? 'lod' : encodingType;
  if (canonicalEncodingType === undefined) {
    throw new Error('encodingType is required when target=encoding');
  }
  const firstPane = normalizeArray(worksheet.table?.panes?.pane)[0];
  return normalizeArray(firstPane?.encodings?.[canonicalEncodingType]).length;
}

function getWorksheet(parsed: any): any | undefined {
  if (parsed.workbook?.worksheets) {
    return normalizeArray(parsed.workbook.worksheets.worksheet)[0];
  }
  if (parsed.workbook?.worksheet) {
    return normalizeArray(parsed.workbook.worksheet)[0];
  }
  if (parsed.worksheet) {
    return normalizeArray(parsed.worksheet)[0];
  }
  return undefined;
}
