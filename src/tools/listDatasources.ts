import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';

export const listDatasourcesTool = new Tool({
  name: 'list-datasources',
  description: `
Retrieves a list of published data sources from a specified Tableau site using the Tableau REST API. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Views) for precise and flexible data source discovery. Use this tool when a user requests to list, search, or filter Tableau data sources on a site.

**Example Usage:**
- List all data sources on a site
- List data sources with the name "Project Views":
  - filter: "name:eq:Project Views"\`
- List data sources in the "Finance" project:
  - filter: "projectName:eq:Finance"\`
- List data sources created after January 1, 2023:
  - filter: "createdAt:gt:2023-01-01T00:00:00Z"\`
- List data sources with the name "Project Views" in the "Finance" project and created after January 1, 2023:
  - filter: "name:eq:Project Views,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"\`
`,
  paramsSchema: {
    filter: z.string().optional(),
  },
  annotations: {
    title: 'List Datasources',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listDatasourcesTool.logAndExecute({
      args: { filter },
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return await restApi.datasourcesMethods.listDatasources(restApi.siteId, filter ?? '');
      },
    });
  },
});
