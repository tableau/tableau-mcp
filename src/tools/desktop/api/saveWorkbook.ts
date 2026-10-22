import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatDesktopWarnings } from '../../../desktop/validation/promise-check.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { IncompleteOperationError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { prefillNextAction, withNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult, toWireWarnings } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  filePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute .twb/.twbx path to Save As; the open workbook then points at this path. Omit to save in place at the current path.',
    ),
};
const title = 'Save Workbook';

export const getSaveWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const saveWorkbookTool = new DesktopTool({
    server,
    name: 'save-workbook',
    minApiVersion: '0.2.6',
    title,
    description:
      'Save the open workbook in place, or pass an absolute .twb/.twbx path to Save As: the workbook is ' +
      'written there and becomes the open document, so later saves go to that path (use workbook-export-as for a copy). ' +
      'A workbook that has never been saved has no path, so omitting filePath then opens the ' +
      'Save As dialog and blocks until a person responds — pass filePath to save it headlessly.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, filePath }, extra): Promise<CallToolResult> => {
      return await saveWorkbookTool.logAndExecute({
        extra,
        args: { session, filePath },
        getSuccessResult: commandSuccessResult,
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'save-workbook',
                async (executor, signal) => await executor.saveWorkbook(filePath, signal),
              );
              if (result.isErr()) {
                return result;
              }

              if (result.value.status !== 'completed') {
                const pending = 'Requested saving the workbook; Desktop is still applying it';
                return new Ok(commandOk({ message: `${pending}.` }, result.value, pending));
              }

              // Only an in-place save can open a Save dialog, and a dismissed one still reports
              // SUCCEEDED, so confirm that write via unsavedChanges. A save to filePath is
              // authoritative on status, as in workbook-export-as.
              if (filePath === undefined) {
                const inventory = await read(
                  'workbook inventory',
                  async (executor, signal) => await executor.getWorkbook(signal),
                );
                if (inventory.isErr()) {
                  return inventory;
                }
                if (inventory.value.unsavedChanges) {
                  const warnings = toWireWarnings(result.value.warnings);
                  return new IncompleteOperationError(
                    withNextAction(
                      {
                        message:
                          'The save did not complete: Desktop reported it finished, but the workbook ' +
                          'still has unsaved changes. A Save dialog may have been dismissed. Do not ' +
                          'retry without filePath unless the user is at the machine, because a retry ' +
                          'reopens a dialog that blocks until a person answers.' +
                          formatDesktopWarnings(warnings, ''),
                        ...(warnings.length > 0 ? { warnings } : {}),
                      },
                      prefillNextAction('Ask the user whether to retry the save'),
                    ),
                  ).toErr();
                }
              }

              const subject =
                filePath !== undefined
                  ? `Saved the workbook as "${filePath}"; it is now the open document`
                  : 'Saved the open workbook';
              return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
            },
          }),
      });
    },
  });

  return saveWorkbookTool;
};
