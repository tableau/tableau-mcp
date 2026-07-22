import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  getWorksheetFragment,
  isRouteMissing,
} from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  addFieldToCols,
  addFieldToEncoding,
  addFieldToRows,
} from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileNotFoundError,
  FileReadError,
  GetWorksheetXmlFailedError,
  McpToolError,
  UnknownError,
  XmlModificationError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

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

/**
 * Fetch an existing worksheet by display name and write it to a cache file, returning that
 * path — the same mint get-worksheet-xml performs. Lets add-field/remove-field be used with
 * a plain worksheet name (no prior get-worksheet-xml call) while preserving the
 * get-once/edit-many/apply-once contract: the returned path is reused across edits.
 */
async function fetchAndCacheWorksheet({
  worksheetName,
  resolvedSession,
  extra,
}: {
  worksheetName: string;
  resolvedSession: string;
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<string, McpToolError>> {
  const executor = await extra.getExecutor(resolvedSession);
  const fetched = await getWorksheetFragment({ worksheetName, executor, signal: extra.signal });
  if (fetched.isErr()) {
    const { type, error } = fetched.error;
    switch (type) {
      case 'get-worksheet-xml-error':
        return Err(new GetWorksheetXmlFailedError(error));
      case 'execute-command-error':
        if (isRouteMissing(error)) {
          return Err(
            new McpToolError({
              type: 'endpoint-not-in-this-build',
              message:
                'This Tableau Desktop build does not serve the worksheet document endpoint yet. ' +
                'Use get-app-info to identify the build; this read lights up on a newer Desktop update. Do not retry.',
              statusCode: 404,
            }),
          );
        }
        return Err(new DesktopCommandExecutionError(error));
      default: {
        const _: never = type;
        return Err(new UnknownError(error));
      }
    }
  }

  const safeName = worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
  const cacheFile = new DesktopCache().getCacheFilePath({ prefix: `worksheet-${safeName}` });
  writeFileSync(cacheFile, fetched.value, 'utf-8');
  writeSidecar(cacheFile, resolvedSession);
  return Ok(cacheFile);
}

const paramsSchema = {
  session: z.string().optional().describe('Desktop session; omit if one.'),
  worksheetName: z
    .string()
    .optional()
    .describe('Sheet to edit; cached on first use. Give this or worksheetFile.'),
  worksheetFile: z
    .string()
    .optional()
    .describe('Cached sheet path from a prior edit; stacks edits.'),
  target: z.enum(FIELD_TARGETS).describe('Placement shelf.'),
  columnRef: z.string().describe('Field to add.'),
  encodingType: z.enum(ENCODING_TYPES).optional().describe('Required when target=encoding.'),
  index: z.number().optional().describe('Optional position.'),
  workbookFile: z.string().optional().describe('Optional workbook.'),
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
