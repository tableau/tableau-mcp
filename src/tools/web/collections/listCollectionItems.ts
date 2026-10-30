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
import { checkCollectionsSupported } from './collectionsCapability.js';
import {
  checkCollectionListingAllowed,
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
      'Comma-separated field:eq:value filters with distinct fields: ownerLuid, title, createdTime, modifiedTime, luid, type, favorite.',
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
      'Lists one page of member references for a collection LUID, with optional paging, eq filters, and sort. Returns content metadata, numeric internal IDs, errors, and available page metadata. Numeric IDs and syncToken cannot be used as content LUIDs. Use list-collections to discover collections and content-specific discovery to obtain member LUIDs. Unavailable when content restrictions are configured. Inspect resultInfo warnings before advancing pages; one page does not establish completeness.',
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
          const allowed = checkCollectionListingAllowed(config.boundedContext);
          if (allowed.isErr()) return allowed;
          const maxResultLimit = config.getMaxResultLimit(tool.name);
          if (maxResultLimit !== null && (pageNumber - 1) * pageSize >= maxResultLimit)
            return new PageExceedsLimitError(
              'The requested collection-items page exceeds the configured result limit.',
            ).toErr();
          const supported = await checkCollectionsSupported(extra);
          if (supported.isErr()) return supported;
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
