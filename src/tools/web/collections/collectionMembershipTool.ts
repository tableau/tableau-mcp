import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { collectionMembershipRequestSchema } from '../../../sdks/tableau/types/collection.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { assertCollectionsSupported } from './collectionsCapability.js';
import {
  assertCollectionMembersAllowed,
  assertCollectionOwner,
  getQuietCollectionsExtra,
} from './collectionsUtils.js';

export const collectionMembershipParamsSchema = {
  collectionId: luidSchema.describe('LUID of a collection owned by the signed-in user.'),
  items: collectionMembershipRequestSchema.shape.items.describe(
    '1–1000 reference objects with contentLuid (UUID), contentType (nonblank, no controls), and optional contentName. Count limit is local policy. TAG documents no contentType enum/casing; exact server-supported spellings need live verification. Existing bound checkers recognize workbook, view, datasource; other types are refused when any content restrictions apply.',
  ),
};

export function getCollectionMembershipTool(
  server: WebMcpServer,
  action: 'add' | 'remove',
): WebTool<typeof collectionMembershipParamsSchema> {
  const tool: WebTool<typeof collectionMembershipParamsSchema> = new WebTool({
    server,
    name: action === 'add' ? 'add-collection-items' : 'remove-collection-items',
    minRequiredRole: SiteRole.VIEWER,
    description: `${action === 'add' ? 'Adds' : 'Removes'} references through POST /api/-/collections/{collectionId}/items/${action === 'add' ? 'batchCreate' : 'batchDelete'}. Accepts an owner-verified collection LUID and member references. Every member is checked before sending the batch. Removing membership never deletes source content. Returns affected count, errors, and an honest completed/partial-failure/unverified status; HTTP 200 may contain partial errors. Never retry a partial batch automatically. No collection deletion, sharing, or ownership transfer. Requires collections:read for owner verification and collections:update. Accepted contentType casing/contentName requirements are not specified by OpenAPI and require live verification.`,
    paramsSchema: collectionMembershipParamsSchema,
    annotations: {
      title: action === 'add' ? 'Add Collection Items' : 'Remove Collection Items',
      readOnlyHint: false,
      destructiveHint: action === 'remove',
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args: {
          collectionId: args.collectionId,
          items: args.items.map(({ contentLuid, contentType }) => ({ contentLuid, contentType })),
        },
        callback: async () => {
          const quietExtra = getQuietCollectionsExtra(extra);
          const parsed = z.object(collectionMembershipParamsSchema).strict().safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          await assertCollectionsSupported(extra);
          await assertCollectionMembersAllowed(parsed.data.items, quietExtra);
          return new Ok(
            await useRestApi({
              ...quietExtra,
              jwtScopes: ['tableau:collections:read', 'tableau:collections:update'],
              callback: async (restApi) => {
                await assertCollectionOwner(restApi, parsed.data.collectionId);
                const response =
                  action === 'add'
                    ? await restApi.collectionsMethods.addCollectionItems(parsed.data)
                    : await restApi.collectionsMethods.removeCollectionItems(parsed.data);
                const errors = response.errors ?? [];
                const countVerified =
                  response.response !== undefined &&
                  response.response >= 0 &&
                  response.response <= parsed.data.items.length;
                return {
                  ...response,
                  operation: action,
                  requestedItemCount: parsed.data.items.length,
                  status: errors.length
                    ? 'partial-failure'
                    : countVerified && response.response === parsed.data.items.length
                      ? 'completed'
                      : 'unverified',
                  message: errors.length
                    ? 'Tableau returned partial errors. Some membership changes may have occurred; inspect the affected count and errors before retrying.'
                    : countVerified && response.response === parsed.data.items.length
                      ? 'Tableau reported the requested number of membership changes. Source content was not deleted.'
                      : 'The affected count does not establish that every requested membership change occurred. Inspect the collection before retrying.',
                };
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
}
