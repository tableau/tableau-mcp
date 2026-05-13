import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopDiscoverer } from '../../../desktop/desktopDiscoverer.js';
import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

export const getListInstancesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const placeholderTool = new DesktopTool({
    server,
    name: 'list-instances',
    title: 'List Running Tableau Desktop Instances',
    description:
      'List all running Tableau Desktop instances. Returns available instances with session IDs that can be used in the session parameter of other tools.',
    paramsSchema,
    annotations: {
      title: 'List Running Tableau Desktop Instances',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, extra): Promise<CallToolResult> => {
      return await placeholderTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const discoverer = new DesktopDiscoverer();
          const instances = discoverer.getInstances();

          if (instances.size === 0) {
            return new NoDesktopInstancesFoundError().toErr();
          }

          const instanceList = Array.from(instances.values()).map((instance) => ({
            sessionId: instance.pid.toString(),
            pid: instance.pid,
            port: instance.port,
            start_time: instance.start_time,
            secret_preview: instance.secret ? `${instance.secret.substring(0, 8)}...` : null,
          }));

          return new Ok({
            message: `Found ${instances.size} running Tableau Desktop ${instances.size === 1 ? 'instance' : 'instances'}.`,
            instances: instanceList,
            instructions:
              'Use the session ID of the instance you want to use in the session parameter of other tools.',
          });
        },
      });
    },
  });

  return placeholderTool;
};
