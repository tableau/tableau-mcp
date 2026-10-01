import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { discoverInstances } from '../../../desktop/externalApi/discovery.js';
import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

type ListedInstance = {
  sessionId: string;
  pid: number;
  baseUrl?: string;
  apiVersion?: string;
  hasToken?: boolean;
};

const title = 'Finding open windows';
export const getListInstancesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const strictScope = getDesktopConfig().desktopSessionScope === 'strict';
  const listInstancesTool = new DesktopTool({
    server,
    name: 'list-instances',
    title,
    description: strictScope
      ? 'List the Tableau Desktop instance allowed by this server strict session scope.'
      : 'List all running Tableau Desktop instances. Returns available instances with session IDs that can be used in the session parameter of other tools.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_, extra): Promise<CallToolResult> => {
      return await listInstancesTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const config = getDesktopConfig();
          const discovered = discoverInstances({
            discoveryDir: config.externalApiDiscoveryDir,
            ...(config.desktopSessionScope === 'strict'
              ? { targetPid: Number(config.desktopSessionId) }
              : {}),
          });
          const external =
            config.desktopSessionScope === 'strict'
              ? discovered.filter((instance) => String(instance.pid) === config.desktopSessionId)
              : discovered;
          if (external.length === 0) {
            return new NoDesktopInstancesFoundError().toErr();
          }
          const instanceList: Array<ListedInstance> = external.map((instance) =>
            config.desktopSessionScope === 'strict'
              ? { sessionId: instance.pid.toString(), pid: instance.pid }
              : {
                  sessionId: instance.pid.toString(),
                  pid: instance.pid,
                  baseUrl: instance.baseUrl,
                  ...(instance.apiVersion !== undefined ? { apiVersion: instance.apiVersion } : {}),
                  hasToken: !!instance.token,
                },
          );
          return new Ok({
            message: `Found ${external.length} running Tableau Desktop ${external.length === 1 ? 'instance' : 'instances'} (External Client API).`,
            instances: instanceList,
            instructions:
              config.desktopSessionScope === 'strict'
                ? 'This server is restricted to this Tableau Desktop session. Omit session or use the listed session ID.'
                : 'Use the session ID of the instance you want to use in the session parameter of other tools.',
          });
        },
      });
    },
  });

  return listInstancesTool;
};
