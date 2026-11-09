import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  filePath: z
    .string()
    .min(1)
    .describe('Absolute path of the local file to open (e.g. a .twb or .twbx workbook).'),
};
const title = 'Open File';

export const getOpenFileTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const openFileTool = new DesktopTool({
    server,
    name: 'open-file',
    minApiVersion: '0.2.6',
    title,
    description:
      'Open a local file in Tableau Desktop by absolute path: a .twb/.twbx opens as a workbook, ' +
      'while a datasource file (Excel, .tds, extract, and the like) attaches to the open workbook, ' +
      'creating one if none is open. Saved sources: see list-saved-datasources. ' +
      'A workbook replaces the open one if that is empty and unsaved, ' +
      'and opening the file that is already open reloads it after a save prompt. Any other workbook opens in a ' +
      'new window; this session stays bound to the original. If a datasource does not appear, ' +
      'check get-active-dialogs.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, filePath }, extra): Promise<CallToolResult> => {
      return await openFileTool.logAndExecute({
        extra,
        args: { session, filePath },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'open-file',
                async (executor, signal) => await executor.openFile(filePath, signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const subject =
            result.value.status === 'completed'
              ? `Opened "${filePath}"`
              : `Requested opening "${filePath}"; Desktop is still applying it`;
          return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
        },
      });
    },
  });

  return openFileTool;
};
