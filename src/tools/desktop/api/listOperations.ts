import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OperationList } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'List Operations';

export const getListOperationsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'list-operations',
    minApiVersion: '0.2.0',
    title,
    description:
      'List in-flight and recent Tableau Desktop operations (id, kind, state, timestamps, and the error with its code and tableauErrorCode when failed), plus any blocking or progress windows. Use get-operation to read one by id.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<OperationList>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'operations',
                async (executor, signal) => await executor.listOperations(signal),
              ),
          }),
      });
    },
  });

  return tool;
};
