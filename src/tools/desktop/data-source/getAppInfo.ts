import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'Get App Info';
export const getAppInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getAppInfo = new DesktopTool({
    server,
    name: 'get-app-info',
    title,
    description: 'Identify the Desktop build when an endpoint 404s as too-new.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getAppInfo.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('app info', async (executor, signal) => await executor.getApp(signal)),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            ...(result.value.applicationVersion !== undefined
              ? { applicationVersion: result.value.applicationVersion }
              : {}),
            ...(result.value.build !== undefined ? { build: result.value.build } : {}),
            ...(result.value.edition !== undefined ? { edition: result.value.edition } : {}),
            ...(result.value.os !== undefined ? { os: result.value.os } : {}),
          });
        },
      });
    },
  });

  return getAppInfo;
};
