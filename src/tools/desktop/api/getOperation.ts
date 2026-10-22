import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { OperationEnvelope } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  operationId: z.string().min(1).describe('The operation id, from the operations list.'),
};

const title = 'Get Operation';

export const getOperationTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-operation',
    title,
    description:
      'Get one Tableau Desktop operation by id: kind, state, result or error, warnings, and timestamps. blockingWindows and progressWindows appear only while it is not in a terminal state.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, operationId }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<OperationEnvelope>({
        extra,
        args: { session, operationId },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'operation',
                async (executor, signal) => await executor.getOperation(operationId, signal),
              ),
          }),
      });
    },
  });

  return tool;
};
