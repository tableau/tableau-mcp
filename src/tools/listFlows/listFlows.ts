import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { paginate } from '../../utils/paginate.js';
import { Tool } from '../tool.js';
import { parseAndValidateFlowFilterString } from './flowsFilterUtils.js';

export const listFlowsTool = new Tool({
  name: 'list-flows',
  description: `
Retrieves a list of published Tableau Prep flows from a specified Tableau site using the Tableau REST API. Supports optional filtering via field:operator:value expressions (e.g., name:eq:SalesFlow) for precise and flexible flow discovery. Use this tool when a user requests to list, search, or filter Tableau Prep flows on a site.

**Supported Filter Fields and Operators**
- name, tags, createdAt etc. (according to Tableau REST API spec)
- eq, in, gt, gte, lt, lte etc.

**Example Usage:**
- List all flows on a site
- List flows with the name "SalesFlow":
    filter: "name:eq:SalesFlow"
- List flows created after January 1, 2023:
    filter: "createdAt:gt:2023-01-01T00:00:00Z"
`,
  paramsSchema: {
    filter: z.string().optional(),
    sort: z.string().optional(),
    pageSize: z.number().gt(0).optional(),
    limit: z.number().gt(0).optional(),
  },
  annotations: {
    title: 'List Flows',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, sort, pageSize, limit }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    const validatedFilter = filter ? parseAndValidateFlowFilterString(filter) : undefined;
    return await listFlowsTool.logAndExecute({
      requestId,
      args: { filter, sort, pageSize, limit },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );

        const flows = await paginate({
          pageConfig: {
            pageSize,
            limit: config.maxResultLimit
              ? Math.min(config.maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
              : limit,
          },
          getDataFn: async (pageConfig) => {
            const { pagination, flows: data } = await restApi.flowsMethods.listFlows({
              siteId: restApi.siteId,
              filter: validatedFilter ?? '',
              sort,
              pageSize: pageConfig.pageSize,
              pageNumber: pageConfig.pageNumber,
            });
            return { pagination, data };
          },
        });

        return new Ok(flows);
      },
    });
  },
}); 