import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

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

const title = 'List Running Tableau Desktop Instances';
export const getListInstancesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listInstancesTool = new DesktopTool({
    server,
    name: 'list-instances',
    title,
    description:
      'List all running Tableau Desktop instances. Returns available instances with session IDs that can be used in the session parameter of other tools.',
    paramsSchema,
    annotations: {
      title,
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
          const external = discoverInstances();
          if (external.length === 0) {
            return new NoDesktopInstancesFoundError().toErr();
          }
          const instanceList: Array<ListedInstance> = external.map((instance) => ({
            sessionId: instance.pid.toString(),
            pid: instance.pid,
            baseUrl: instance.baseUrl,
            ...(instance.apiVersion !== undefined ? { apiVersion: instance.apiVersion } : {}),
            hasToken: !!instance.token,
          }));
          return new Ok({
            message: `Found ${external.length} running Tableau Desktop ${external.length === 1 ? 'instance' : 'instances'} (External Client API).`,
            instances: instanceList,
            instructions:
              'Use the session ID of the instance you want to use in the session parameter of other tools.',
          });
        },
      });
    },
  });

  return listInstancesTool;
};
