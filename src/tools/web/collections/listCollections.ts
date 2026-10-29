import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  collectionsFilterSchema,
  collectionsSortSchema,
} from '../../../sdks/tableau/types/collectionsQuery.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { assertCollectionsSupported } from './collectionsCapability.js';
import {
  assertCollectionListingAllowed,
  COLLECTIONS_WIRE_LIMITATION,
  describeCollectionPage,
  getQuietCollectionsExtra,
} from './collectionsUtils.js';

export const collectionsPagingParams = {
  pageNumber: z
    .number()
    .int()
    .min(1)
    .max(2147483647)
    .optional()
    .describe('1-based page number, default 1. Positive paging is a local candidate constraint.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      'Items requested in one page, default 100. The 1000-item maximum is a local candidate safety cap; TAG has no documented page-size bounds.',
    ),
};
export const listCollectionsParamsSchema = {
  ...collectionsPagingParams,
  filter: collectionsFilterSchema
    .optional()
    .describe(
      'Optional distinct-field field:eq:value expressions, comma-separated. Documented fields: ownerLuid, visibility, createdTime, updatedTime, luid, siteId, favorite. Only eq is exposed locally; the official field/operator matrix is unspecified.',
    ),
  sort: collectionsSortSchema
    .optional()
    .describe(
      'One field:asc or field:desc. Fields: visibility, createdTime, updatedTime, ownerName, name, modifiedTime.',
    ),
};

export const getListCollectionsTool = (
  server: WebMcpServer,
): WebTool<typeof listCollectionsParamsSchema> => {
  const tool: WebTool<typeof listCollectionsParamsSchema> = new WebTool({
    server,
    name: 'list-collections',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Lists one page of Collections metadata through GET /api/-/collections for the authenticated site. Accepts optional paging, eq filters, and sort; preserves items, errors, moreItems, totalCount, and pagination. Use list-collection-items to inspect members. Listing refuses configured bounded-content contexts because documented member identities cannot be safely resolved. ' +
      COLLECTIONS_WIRE_LIMITATION,
    paramsSchema: listCollectionsParamsSchema,
    annotations: {
      title: 'List Collections',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const quietExtra = getQuietCollectionsExtra(extra);
          const parsed = z.object(listCollectionsParamsSchema).safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          const { pageNumber = 1, pageSize = 100, filter, sort } = parsed.data;
          const config = await quietExtra.getConfigWithOverrides();
          assertCollectionListingAllowed(config.boundedContext);
          const maxResultLimit = config.getMaxResultLimit(tool.name);
          if (maxResultLimit !== null && (pageNumber - 1) * pageSize >= maxResultLimit)
            return new PageExceedsLimitError(
              'The requested Collections page exceeds the configured result limit.',
            ).toErr();
          await assertCollectionsSupported(extra);
          return new Ok(
            await useRestApi({
              ...quietExtra,
              jwtScopes: ['tableau:collections:read'],
              callback: async (restApi) =>
                describeCollectionPage(
                  await restApi.collectionsMethods.listCollections({
                    pageNumber,
                    pageSize,
                    filter,
                    sort,
                  }),
                  pageNumber,
                  pageSize,
                  maxResultLimit,
                ),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
