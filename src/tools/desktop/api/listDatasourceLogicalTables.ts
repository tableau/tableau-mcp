import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DATASOURCE_LOGICAL_TABLES_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource', { min: 1 }),
};
const title = 'List Datasource Logical Tables';

export const getListDatasourceLogicalTablesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listDatasourceLogicalTables = new DesktopTool({
    server,
    name: 'list-datasource-logical-tables',
    minApiVersion: DATASOURCE_LOGICAL_TABLES_MIN_API_VERSION,
    title,
    description:
      "List a datasource's logical tables (id + caption), the input to get-datasource-underlying-data.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, datasourceName }, extra): Promise<CallToolResult> => {
      return await listDatasourceLogicalTables.logAndExecute({
        extra,
        args: { session, datasourceName },
        callback: async () => {
          const resolved = await resolveDatasourceRef({ session, datasourceName, extra });
          if (resolved.isErr()) {
            return resolved;
          }
          const datasourceId = resolved.value.id;

          return await runExternalApiReadTool({
            session: resolved.value.resolvedSession,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'datasource logical tables',
                async (executor, signal) =>
                  await executor.listDatasourceLogicalTables(datasourceId, signal),
              ),
          });
        },
      });
    },
  });

  return listDatasourceLogicalTables;
};
