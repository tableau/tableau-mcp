import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WorkbookExtensionList } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get workbook extensions';

export const getWorkbookExtensionsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-workbook-extensions',
    minApiVersion: '0.2.27',
    title,
    description:
      'Lists viz and dashboard extensions in the open workbook. Reload one with its sheet id.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<WorkbookExtensionList>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'GET /v0/workbook/extensions',
                async (executor, signal) => await executor.listWorkbookExtensions(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          }),
      });
    },
  });

  return tool;
};
