import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WORKBOOK_CLOSE_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Close Workbook';

export const getCloseWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const closeWorkbookTool = new DesktopTool({
    server,
    name: 'close-workbook',
    minApiVersion: WORKBOOK_CLOSE_MIN_API_VERSION,
    title,
    description:
      'Close the open workbook (File > Close). A workbook with no unsaved changes, or an empty ' +
      'untitled one, closes headlessly. Otherwise Desktop shows its native save prompt and blocks ' +
      'until a person responds: declining closes without saving, saving writes the workbook first, ' +
      'and cancelling leaves it open. Call save-workbook first to close without a prompt.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await closeWorkbookTool.logAndExecute({
        extra,
        args: { session },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'close-workbook',
                async (executor, signal) =>
                  await withApplyLock(async () => await executor.closeWorkbook(signal)),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const subject =
            result.value.status === 'completed'
              ? 'Closed the open workbook'
              : 'Requested closing the workbook; Desktop is still applying it';
          return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
        },
      });
    },
  });

  return closeWorkbookTool;
};
