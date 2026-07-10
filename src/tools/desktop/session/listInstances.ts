import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { DesktopDiscoverer } from '../../../desktop/desktopDiscoverer.js';
import { discoverInstances } from '../../../desktop/externalApi/discovery.js';
import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

/** One listed instance — union of the two transports' shapes (discriminated by fields present). */
type ListedInstance = {
  sessionId: string;
  pid: number;
  port?: number;
  startTime?: string;
  hasSecret?: boolean;
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
          // W60: the two transports discover Desktop DIFFERENTLY. The External Client
          // API writes per-pid discovery files; the legacy Agent API writes
          // agent-manifest.json. A mainline (External-API) build never writes the
          // legacy manifest, so reading it unconditionally reports "no instances"
          // even while the External-API executor works — live-hit on 2026-07-07.
          if (getDesktopConfig().externalApiEnabled) {
            const external = discoverInstances();
            if (external.length === 0) {
              return new NoDesktopInstancesFoundError().toErr();
            }
            const externalList: Array<ListedInstance> = external.map((instance) => ({
              sessionId: instance.pid.toString(),
              pid: instance.pid,
              baseUrl: instance.baseUrl,
              ...(instance.apiVersion !== undefined ? { apiVersion: instance.apiVersion } : {}),
              hasToken: !!instance.token,
            }));
            return new Ok({
              message: `Found ${external.length} running Tableau Desktop ${external.length === 1 ? 'instance' : 'instances'} (External Client API).`,
              instances: externalList,
              instructions:
                'Use the session ID of the instance you want to use in the session parameter of other tools.',
            });
          }

          const discoverer = new DesktopDiscoverer();
          const instances = discoverer.getInstances();

          if (instances.size === 0) {
            return new NoDesktopInstancesFoundError().toErr();
          }

          const instanceList: Array<ListedInstance> = Array.from(instances.values()).map(
            (instance) => ({
              sessionId: instance.pid.toString(),
              pid: instance.pid,
              port: instance.port,
              startTime: instance.start_time,
              hasSecret: !!instance.secret,
            }),
          );

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

  return listInstancesTool;
};
