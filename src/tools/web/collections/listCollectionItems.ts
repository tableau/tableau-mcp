import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  collectionItemsFilterSchema,
  collectionItemsSortSchema,
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
import { collectionsPagingParams } from './listCollections.js';

export const listCollectionItemsParamsSchema = {
  collectionId: luidSchema.describe('Collection LUID from list-collections or create-collection.'),
  ...collectionsPagingParams,
  filter: collectionItemsFilterSchema
    .optional()
    .describe(
      'Distinct-field field:eq:value filters. Fields: ownerLuid, title, createdTime, modifiedTime, luid, type, favorite. Only eq is exposed locally because the official operator matrix is unspecified.',
    ),
  sort: collectionItemsSortSchema
    .optional()
    .describe(
      'One field:asc or field:desc. Fields: position, createdTime, modifiedTime, ownerName, title, type.',
    ),
};

export const getListCollectionItemsTool = (
  server: WebMcpServer,
): WebTool<typeof listCollectionItemsParamsSchema> => {
  const tool: WebTool<typeof listCollectionItemsParamsSchema> = new WebTool({
    server,
    name: 'list-collection-items',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Lists one page of member references through GET /api/-/collections/{collectionId}/items. Accepts a Collection LUID and optional paging, eq filter, and sort. Returns documented content metadata, numeric internal IDs, errors, and page metadata. Numeric IDs and syncToken are not REST content LUIDs. Use list-collections to discover containers; use content-specific discovery for usable member LUIDs. Refuses all bounded-content contexts. ' +
      COLLECTIONS_WIRE_LIMITATION,
    paramsSchema: listCollectionItemsParamsSchema,
    annotations: {
      title: 'List Collection Items',
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
          const parsed = z.object(listCollectionItemsParamsSchema).safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          const { collectionId, pageNumber = 1, pageSize = 100, filter, sort } = parsed.data;
          const config = await quietExtra.getConfigWithOverrides();
          assertCollectionListingAllowed(config.boundedContext);
          const maxResultLimit = config.getMaxResultLimit(tool.name);
          if (maxResultLimit !== null && (pageNumber - 1) * pageSize >= maxResultLimit)
            return new PageExceedsLimitError(
              'The requested collection-items page exceeds the configured result limit.',
            ).toErr();
          await assertCollectionsSupported(extra);
          return new Ok(
            await useRestApi({
              ...quietExtra,
              jwtScopes: ['tableau:collections:read'],
              callback: async (restApi) =>
                describeCollectionPage(
                  await restApi.collectionsMethods.listCollectionItems({
                    collectionId,
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
