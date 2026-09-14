import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { projectDatasource } from './datasourceResult.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource'),
};

const title = 'Get Datasource Info';

export const getDatasourceInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDatasourceInfo = new DesktopTool({
    server,
    name: 'get-datasource-info',
    minApiVersion: '0.2.10',
    title,
    description: 'Read metadata for one datasource in the open workbook by name or inventory id.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, datasourceName }, extra): Promise<CallToolResult> => {
      return await getDatasourceInfo.logAndExecute({
        extra,
        args: { session, datasourceName },
        callback: async () => {
          const resolvedResult = await resolveDatasourceRef({
            session,
            datasourceName,
            extra,
          });
          if (resolvedResult.isErr()) {
            return resolvedResult;
          }
          const resolved = resolvedResult.value;

          const metadataResult = await runExternalApiReadTool({
            session: resolved.resolvedSession,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'datasource metadata',
                async (executor, signal) =>
                  await executor.getWorkbookDatasource(resolved.id, signal),
              ),
          });
          if (metadataResult.isErr()) {
            return metadataResult;
          }

          return new Ok(projectDatasource(metadataResult.value));
        },
      });
    },
  });

  return getDatasourceInfo;
};
