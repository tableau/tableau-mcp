import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { CONTENT_TAG_UPDATE_API_SCOPES } from '../../../server/oauth/scopes.js';
import { withContentTagResponseValidation } from '../_lib/contentTagResponse.js';
import { WebTool } from '../tool.js';
import {
  contentTagLabelSchema,
  ContentTagResourceType,
  contentTagResourceTypeSchema,
  getContentTagAccessError,
  MAX_CONTENT_TAG_ADDITIONS,
} from './contentTags.js';

const paramsSchema = {
  resourceType: contentTagResourceTypeSchema.describe('The published content type to tag.'),
  resourceId: luidSchema.describe(
    'The Tableau LUID of the workbook, view or published data source.',
  ),
  tagLabels: z
    .array(contentTagLabelSchema)
    .min(1)
    .max(MAX_CONTENT_TAG_ADDITIONS, 'Tool limit: at most 50 tag labels per request')
    .describe(
      'Exact decoded labels to add. Tool caps: 1–50 labels, each at most 256 UTF-16 code units.',
    ),
};

type AddContentTagsResult = {
  resourceType: ContentTagResourceType;
  resourceId: string;
  addedTagLabels: string[];
};

/** Adds only the requested labels; Tableau preserves existing tags and ignores existing labels. */
export const getAddContentTagsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'add-content-tags',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Adds tags to one workbook, published view or published data source. Existing tags are preserved. ' +
      'Exact duplicate additions are deduplicated. Labels are decoded text; Unicode and special characters are preserved. ' +
      'The pending-deletion namespace (including case, whitespace and malformed-date variants) is reserved for content lifecycle tools. ' +
      'Tool limits: 1–50 labels per call, at most 256 UTF-16 code units per label, no ASCII controls. ' +
      'Requires Read permission on the content; Tableau enforces permissions.',
    paramsSchema,
    annotations: {
      title: 'Add Content Tags',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute<AddContentTagsResult>({
        extra,
        args,
        callback: async () => {
          // Also validate direct callback callers, before even a bounded-context REST lookup.
          const parsed = z.object(paramsSchema).safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          const { resourceType, resourceId } = parsed.data;
          const tagLabels = [...new Set(parsed.data.tagLabels)];
          const accessError = await getContentTagAccessError(resourceType, resourceId, extra);
          if (accessError) return accessError.toErr();

          await withContentTagResponseValidation(
            () =>
              useRestApi({
                ...extra,
                // The additive REST response includes all existing tags, beyond this tool's result.
                disableLogging: true,
                jwtScopes: CONTENT_TAG_UPDATE_API_SCOPES[resourceType],
                callback: async (restApi) => {
                  const common = { siteId: restApi.siteId, tagLabels };
                  switch (resourceType) {
                    case 'workbook':
                      await restApi.workbooksMethods.addTagsToWorkbook({
                        ...common,
                        workbookId: resourceId,
                      });
                      break;
                    case 'view':
                      await restApi.viewsMethods.addTagsToView({ ...common, viewId: resourceId });
                      break;
                    case 'datasource':
                      await restApi.datasourcesMethods.addTagsToDatasource({
                        ...common,
                        datasourceId: resourceId,
                      });
                      break;
                  }
                },
              }),
            true,
          );
          return new Ok({ resourceType, resourceId, addedTagLabels: tagLabels });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
