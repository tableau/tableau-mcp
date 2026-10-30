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
import { checkCollectionsSupported } from './collectionsCapability.js';
import {
  checkCollectionListingAllowed,
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
    .describe('1-based page number, default 1.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Items requested in one page, from 1 to 1000, default 100.'),
};
export const listCollectionsParamsSchema = {
  ...collectionsPagingParams,
  filter: collectionsFilterSchema
    .optional()
    .describe(
      'Optional comma-separated field:eq:value filters with distinct fields: ownerLuid, visibility, createdTime, updatedTime, luid, siteId, favorite.',
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
      'Lists one page of collections on the authenticated site with optional paging, eq filters, and sort. Returns collection metadata, item-level errors, and available page metadata. Use list-collection-items to inspect members. Unavailable when content restrictions are configured. A single page does not establish a complete inventory; inspect resultInfo warnings before advancing pages.',
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
          const allowed = checkCollectionListingAllowed(config.boundedContext);
          if (allowed.isErr()) return allowed;
          const maxResultLimit = config.getMaxResultLimit(tool.name);
          if (maxResultLimit !== null && (pageNumber - 1) * pageSize >= maxResultLimit)
            return new PageExceedsLimitError(
              'The requested Collections page exceeds the configured result limit.',
            ).toErr();
          const supported = await checkCollectionsSupported(extra);
          if (supported.isErr()) return supported;
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
