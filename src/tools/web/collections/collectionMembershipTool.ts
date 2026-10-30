import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  collectionMembershipRequestSchema,
  MAX_COLLECTION_MEMBERSHIP_ITEMS,
} from '../../../sdks/tableau/types/collection.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { checkCollectionsSupported } from './collectionsCapability.js';
import {
  checkCollectionMembersAllowed,
  checkCollectionOwnerSession,
  getQuietCollectionsExtra,
  verifyCollectionOwner,
} from './collectionsUtils.js';

export const collectionMembershipParamsSchema = {
  collectionId: luidSchema.describe('LUID of a collection owned by the signed-in user.'),
  items: collectionMembershipRequestSchema.shape.items.describe(
    `1–${MAX_COLLECTION_MEMBERSHIP_ITEMS} unique references with contentLuid (UUID), contentType (nonblank, no controls), and optional contentName. Use workbook, view, or datasource for contentType when content restrictions are configured; other types are refused under restrictions.`,
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
    description: `${action === 'add' ? 'Adds references to' : 'Removes references from'} a collection owned by the signed-in user. Accepts a collection LUID and member references; every member must pass configured content restrictions before the batch is sent. Removing membership never deletes source content. Returns the affected count, errors, and completed/partial-failure/unverified status. Some changes may occur before a partial error; inspect the collection before retrying and never retry a partial batch automatically. Does not delete or share collections or transfer ownership.`,
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
          const supported = await checkCollectionsSupported(extra);
          if (supported.isErr()) return supported;
          const allowed = await checkCollectionMembersAllowed(parsed.data.items, quietExtra);
          if (allowed.isErr()) return allowed;
          const owner = await verifyCollectionOwner(parsed.data.collectionId, quietExtra);
          if (owner.isErr()) return owner;
          return await useRestApi({
            ...quietExtra,
            jwtScopes: ['tableau:collections:read', 'tableau:collections:update'],
            callback: async (restApi) => {
              const session = await checkCollectionOwnerSession(restApi, owner.value);
              if (session.isErr()) return session;
              const response =
                action === 'add'
                  ? await restApi.collectionsMethods.addCollectionItems(parsed.data)
                  : await restApi.collectionsMethods.removeCollectionItems(parsed.data);
              const errors = response.errors ?? [];
              const countVerified =
                response.response !== undefined &&
                response.response >= 0 &&
                response.response <= parsed.data.items.length;
              return new Ok({
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
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
}
