import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExportAsWorkbookRequest } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  format: z
    .enum(['pdf', 'powerpoint', 'packaged-workbook', 'prior-version'])
    .describe('Export format.'),
  filePath: z.string().min(1).describe('Absolute output path; extension must match format.'),
  targetVersion: z
    .string()
    .min(1)
    .optional()
    .describe('Release e.g. "2024.1"; only for prior-version.'),
};
const title = 'Export Workbook';

export const getWorkbookExportAsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const workbookExportAsTool = new DesktopTool({
    server,
    name: 'workbook-export-as',
    minApiVersion: '0.2.7',
    title,
    description:
      'Export the open workbook to a file, leaving the open document unchanged. ' +
      'format→extension: pdf→.pdf, powerpoint→.pptx, packaged-workbook→.twbx, ' +
      'prior-version→.twb/.twbx (a down-saved copy for an older release; also pass ' +
      'targetVersion). Writes headlessly to filePath; no dialog, no returned bytes.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // the required filePath can overwrite an existing file at that path
      idempotentHint: true, // re-running overwrites the same file
      openWorldHint: false,
    },
    paramsSchema,
    callback: async (
      { session, format, filePath, targetVersion },
      extra,
    ): Promise<CallToolResult> => {
      return await workbookExportAsTool.logAndExecute({
        extra,
        args: { session, format, filePath, targetVersion },
        callback: async () => {
          // A prior-version down-save needs the target release. Reject the missing case here so the
          // caller gets a precise, machine-readable ask (args-validation, 400) instead of a generic
          // server rejection. Every other validation (path shape, extension↔format matrix, unknown
          // version) is the server's — see the tool docs.
          if (format === 'prior-version' && targetVersion === undefined) {
            return new ArgsValidationError(
              'Exporting to a prior version requires targetVersion (e.g. "2024.1").',
            ).toErr();
          }

          // targetVersion is meaningful only for prior-version, so drop it on every other format
          // rather than forward a value the server would ignore (matches the param docs).
          const request: ExportAsWorkbookRequest = {
            format,
            filePath,
            ...(format === 'prior-version' ? { targetVersion } : {}),
          };

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'workbook-export-as',
                async (executor, signal) => await executor.exportWorkbookAs(request, signal),
              );
              if (result.isErr()) {
                return result;
              }

              // exportAs never opens a dialog, so a completed status is authoritative — no
              // post-write inventory re-read is needed (that guard exists only for save-workbook's
              // dismissable Save As dialog).
              if (result.value.status !== 'completed') {
                return new Ok({
                  message: 'Requested exporting the workbook; Desktop is still applying it.',
                });
              }

              return new Ok({ message: `Exported the workbook to "${filePath}".` });
            },
          });
        },
      });
    },
  });

  return workbookExportAsTool;
};
