import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  removeFieldFromCols,
  removeFieldFromEncoding,
  removeFieldFromRows,
} from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { wellFormedXmlRule } from '../../../../desktop/validation/rules/wellFormedXml.js';
import { writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
  XmlValidationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, prefillNextAction, withNextAction } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { fetchAndCacheWorksheet, resolveWorksheetBufferId } from './worksheetCache.js';
import { getStickyWorksheetFile, setStickyWorksheetFile } from './worksheetEditBuffer.js';

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
  session: sessionParam(),
  worksheetName: z
    .string()
    .optional()
    .describe('Sheet to edit; name-only calls continue the open edit buffer.'),
  worksheetFile: z
    .string()
    .optional()
    .describe('Cached sheet path to force an edit target; omit to continue the open edit buffer.'),
  target: z.enum(FIELD_TARGETS).describe('Placement shelf.'),
  columnRef: z.string().describe('Field to remove.'),
  encodingType: z.enum(ENCODING_TYPES).optional().describe('Required when target=encoding.'),
};

const title = 'Removing field';
export const getRemoveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const removeFieldTool = new DesktopTool({
    server,
    name: 'remove-field',
    title,
    description: 'Remove a field from a shelf (rows/cols/encoding); counterpart to add-field.',
    paramsSchema,
    annotations: {
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

          const trimmedWorksheetName = worksheetName?.trim() || undefined;

          let bufferWorksheetId: string | undefined;
          if (trimmedWorksheetName) {
            const resolved = await resolveWorksheetBufferId({
              worksheetRef: trimmedWorksheetName,
              resolvedSession,
              extra,
            });
            if (resolved.isErr()) {
              return resolved.error.toErr();
            }
            bufferWorksheetId = resolved.value;
          }

          // Name-based path: reuse the sticky edit buffer for this sheet if one is open,
          // otherwise fetch fresh and mint a new cache file. Either way, later name-only
          // calls for the same sheet+session keep landing on this file until
          // apply-worksheet closes the buffer.
          if (!worksheetFile?.trim()) {
            const sticky = getStickyWorksheetFile({
              session: resolvedSession,
              worksheetId: bufferWorksheetId!,
            });
            if (sticky) {
              worksheetFile = sticky;
            } else {
              const minted = await fetchAndCacheWorksheet({
                worksheetName: trimmedWorksheetName!,
                resolvedSession,
                extra,
              });
              if (minted.isErr()) {
                return minted.error.toErr();
              }
              worksheetFile = minted.value;
            }
          }

          // A worksheetName given alongside an explicit worksheetFile is an override —
          // point the buffer at it too, so later name-only calls continue from here.
          if (bufferWorksheetId) {
            setStickyWorksheetFile({
              session: resolvedSession,
              worksheetId: bufferWorksheetId,
              file: worksheetFile,
            });
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

          return new Ok(
            withNextAction(
              {
                message: `Successfully removed field from ${placement}. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
                file: worksheetFile,
              },
              prefillNextAction('Apply worksheet edits'),
            ),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return removeFieldTool;
};
