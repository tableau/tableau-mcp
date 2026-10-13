import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkCacheFileArg, readCacheFileArg } from '../../../../desktop/cachePath.js';
import { writeRedactedXmlCacheFileArg } from '../../../../desktop/limits/redactedXmlCache.js';
import {
  removeFieldFromCols,
  removeFieldFromEncoding,
  removeFieldFromRows,
} from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { wellFormedXmlRule } from '../../../../desktop/validation/rules/wellFormedXml.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  XmlModificationError,
  XmlValidationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { FieldRemovalPlacement, removeFieldResult } from './removeFieldResult.js';
import { resolveWorksheetEditFile } from './worksheetEditBuffer.js';

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
  worksheetName: z.string().optional().describe('Sheet to edit; or supply worksheetFile.'),
  worksheetFile: z.string().optional().describe('Cached path; omit to continue edits by name.'),
  target: z.enum(FIELD_TARGETS).describe('Confirmed shelf.'),
  columnRef: z.string().describe('Exact placed reference.'),
  encodingType: z
    .enum(ENCODING_TYPES)
    .optional()
    .describe('Required for encoding; detail=lod; first pane.'),
};

const title = 'Removing field';
export const getRemoveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const removeFieldTool = new DesktopTool({
    server,
    name: 'remove-field',
    title,
    description:
      'Remove a field, without moving it. Inspect current placements first. ' +
      'Reuse the same cached file for pending edits; live reads reset them.',
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
          if (worksheetFile?.trim()) {
            const checked = checkCacheFileArg(
              'worksheetFile',
              worksheetFile,
              (path) => new FileNotFoundError(path),
            );
            if (checked.isErr()) return checked.error.toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const editFile = await resolveWorksheetEditFile({
            worksheetName,
            worksheetFile,
            resolvedSession,
            extra,
          });
          if (editFile.isErr()) {
            return editFile.error.toErr();
          }
          worksheetFile = editFile.value;

          // encodingType is conditionally required — enforced here (not in the JSON Schema) so
          // the schema stays flat and host-portable.
          if (target === 'encoding' && !encodingType) {
            return new ArgsValidationError(
              `encodingType is required when target=encoding. Provide one of: ${ENCODING_TYPES.join(', ')}.`,
            ).toErr();
          }

          const worksheetRead = readCacheFileArg(
            'worksheetFile',
            worksheetFile,
            (path) => new FileNotFoundError(path),
          );
          if (worksheetRead.isErr()) return worksheetRead.error.toErr();
          const worksheetXml = worksheetRead.value.text;

          let modifiedXml: string;
          let placement: FieldRemovalPlacement;
          let removalResult: ReturnType<typeof removeFieldResult>;
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
                placement = `${encodingType!} encoding`;
                break;
              default: {
                const _exhaustive: never = target;
                throw new Error(`Unknown target: ${String(_exhaustive)}`);
              }
            }
            // Build the receipt before writing so a snapshot failure cannot leave a changed draft.
            removalResult = removeFieldResult(placement, worksheetFile, columnRef, modifiedXml);
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

          const written = writeRedactedXmlCacheFileArg('worksheetFile', worksheetFile, modifiedXml);
          if (written.isErr()) return written.error.toErr();

          return new Ok(removalResult);
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return removeFieldTool;
};
