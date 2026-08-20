import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Publish Workbook';

export const getPublishWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const publishWorkbookTool = new DesktopTool({
    server,
    name: 'publish-workbook',
    minApiVersion: '0.2.8',
    title,
    description:
      'Open the Publish Workbook dialog to publish the open workbook to the connected Tableau site. ' +
      'The dialog is interactive: a returned success means the flow was launched, not that a publish ' +
      'landed — dismissing or cancelling it also succeeds. Requires being signed in to a site.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true, // publishes to a remote Tableau site
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await publishWorkbookTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'publish-workbook',
                async (executor, signal) => await executor.publishWorkbook(signal),
              );
              if (result.isErr()) {
                return result;
              }

              if (result.value.status !== 'completed') {
                return new Ok({
                  message:
                    'Requested opening the Publish Workbook dialog; Desktop is still applying it.',
                });
              }

              return new Ok({
                message: 'Opened the Publish Workbook dialog; finish or cancel it in Tableau.',
              });
            },
          });
        },
      });
    },
  });

  return publishWorkbookTool;
};
