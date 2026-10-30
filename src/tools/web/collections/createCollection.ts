import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { createCollectionSchema } from '../../../sdks/tableau/types/collection.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { checkCollectionsSupported } from './collectionsCapability.js';
import { getQuietCollectionsExtra } from './collectionsUtils.js';

export const createCollectionParamsSchema = {
  name: createCollectionSchema.shape.name.describe(
    'Nonblank collection name; Tableau may add a numeric suffix for duplicate names.',
  ),
  description: createCollectionSchema.shape.description.describe(
    'Optional collection description.',
  ),
};

export const getCreateCollectionTool = (
  server: WebMcpServer,
): WebTool<typeof createCollectionParamsSchema> => {
  const tool: WebTool<typeof createCollectionParamsSchema> = new WebTool({
    server,
    name: 'create-collection',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Creates an empty private collection using a name and optional description. Returns the actual name and collection LUID. Use add-collection-items separately to add references. Duplicate names may receive a numeric suffix; inspect the site before retrying an uncertain creation to avoid duplicates. Does not share collections or transfer ownership.',
    paramsSchema: createCollectionParamsSchema,
    annotations: {
      title: 'Create Collection',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args: {
          name: '<redacted>',
          description: args.description === undefined ? undefined : '<redacted>',
        },
        callback: async () => {
          const quietExtra = getQuietCollectionsExtra(extra);
          const parsed = createCollectionSchema.safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          const supported = await checkCollectionsSupported(extra);
          if (supported.isErr()) return supported;
          const collection = await useRestApi({
            ...quietExtra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.collectionsMethods.createCollection(parsed.data),
          });
          if (!luidSchema.safeParse(collection.luid).success)
            return new McpToolError({
              type: 'collection-create-response-unverified',
              statusCode: 502,
              message:
                'Tableau answered the create request without a usable collection LUID. Creation may have occurred; inspect the site before retrying to avoid duplicate collections.',
            }).toErr();
          return new Ok(collection);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
