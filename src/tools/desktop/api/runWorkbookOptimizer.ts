import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { runWorkbookOptimizer } from '../../../desktop/wrappers/runWorkbookOptimizer.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Run Workbook Optimizer';

export const getRunWorkbookOptimizerTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const workbookOptimizerTool = new DesktopTool({
    server,
    name: 'run-workbook-optimizer',
    minApiVersion: '0.2.11',
    title,
    description:
      'Evaluate the open workbook with Workbook Optimizer and return its suggestions without changing the workbook.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await workbookOptimizerTool.logAndExecute({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'workbook optimizer',
                async (executor, signal) => await runWorkbookOptimizer({ executor, signal }),
              ),
          }),
      });
    },
  });

  return workbookOptimizerTool;
};
