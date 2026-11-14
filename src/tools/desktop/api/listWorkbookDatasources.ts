import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { getDatasourcesTool } from './getDatasources.js';

const paramsSchema = {
  session: sessionParam(),
};

export const getListWorkbookDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDatasources = getDatasourcesTool(server);
  return new DesktopTool({
    server,
    name: 'list-workbook-datasources',
    title: 'List Workbook Datasources',
    description:
      'Deprecated: use get-datasources instead. Same as get-datasources without datasourceId.',
    paramsSchema,
    annotations: getDatasources.annotations,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      const callback = await Provider.from(getDatasources.callback);
      return await callback({ session, datasourceId: undefined }, extra);
    },
  });
};
