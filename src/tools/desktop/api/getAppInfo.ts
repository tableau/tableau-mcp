import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

type GetAppInfoResult =
  | {
      applicationVersion?: string;
      build?: string;
      edition?: string;
      os?: string;
      isStartPageVisible?: boolean;
      isDataSourcePageActive?: boolean;
      isPresentationMode?: boolean;
    }
  | {
      status: 'unavailable';
      message: string;
    };

const title = 'Get App Info';
export const getAppInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getAppInfo = new DesktopTool({
    server,
    name: 'get-app-info',
    title,
    description:
      'Identify the Desktop build when an endpoint 404s as too-new, and read live UI state (Start Page visibility, Data Source page active, presentation mode).',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getAppInfo.logAndExecute<GetAppInfoResult>({
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

          const appInfo = {
            ...(result.value.applicationVersion !== undefined
              ? { applicationVersion: result.value.applicationVersion }
              : {}),
            ...(result.value.build !== undefined ? { build: result.value.build } : {}),
            ...(result.value.edition !== undefined ? { edition: result.value.edition } : {}),
            ...(result.value.os !== undefined ? { os: result.value.os } : {}),
            ...(result.value.isStartPageVisible !== undefined
              ? { isStartPageVisible: result.value.isStartPageVisible }
              : {}),
            ...(result.value.isDataSourcePageActive !== undefined
              ? { isDataSourcePageActive: result.value.isDataSourcePageActive }
              : {}),
            ...(result.value.isPresentationMode !== undefined
              ? { isPresentationMode: result.value.isPresentationMode }
              : {}),
          };

          if (Object.keys(appInfo).length === 0) {
            return new Ok({
              status: 'unavailable' as const,
              message: 'Desktop app info endpoint returned no application metadata fields.',
            });
          }

          return new Ok(appInfo);
        },
      });
    },
  });

  return getAppInfo;
};
