import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { CONTENT_TAG_DELETE_API_SCOPES } from '../../../server/oauth/scopes.js';
import { withContentTagResponseValidation } from '../_lib/contentTagResponse.js';
import { WebTool } from '../tool.js';
import {
  ContentTagResourceType,
  contentTagResourceTypeSchema,
  getContentTagAccessError,
  getProtectedBoundaryTagError,
  removableContentTagLabelSchema,
} from './contentTags.js';

const paramsSchema = {
  resourceType: contentTagResourceTypeSchema.describe('The published content type to untag.'),
  resourceId: luidSchema.describe(
    'The Tableau LUID of the workbook, view or published data source.',
  ),
  tagLabel: removableContentTagLabelSchema.describe(
    'The exact decoded label to remove. Do not URL-encode it. Tool cap: 256 UTF-16 code units.',
  ),
};

type RemoveContentTagResult = {
  resourceType: ContentTagResourceType;
  resourceId: string;
  removedTagLabel: string;
};

/** Removes one exact label using the dedicated REST endpoint; never replaces a tag collection. */
export const getRemoveContentTagTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'remove-content-tag',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Removes one exact tag label from a workbook, published view or published data source. Other tags are preserved. ' +
      'Pass decoded text; the SDK URL-encodes it exactly once. The pending-deletion namespace is reserved for content lifecycle tools. ' +
      'Tool cap: 256 UTF-16 code units, no ASCII controls. Labels containing slash, backslash, traversal segments or unsafe percent-encoded sequences cannot be removed by this tool. ' +
      'Requires Read permission and, for non-administrators, permission to remove this tag (such as having added it). Tableau enforces permissions.',
    paramsSchema,
    annotations: {
      title: 'Remove Content Tag',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute<RemoveContentTagResult>({
        extra,
        args,
        callback: async () => {
          const parsed = z.object(paramsSchema).safeParse(args);
          if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
          const { resourceType, resourceId, tagLabel } = parsed.data;
          const config = await extra.getConfigWithOverrides();
          const boundaryError = getProtectedBoundaryTagError(tagLabel, config);
          if (boundaryError) return boundaryError.toErr();
          const accessError = await getContentTagAccessError(
            resourceType,
            resourceId,
            extra,
            config,
          );
          if (accessError) return accessError.toErr();

          await withContentTagResponseValidation(
            () =>
              useRestApi({
                ...extra,
                disableLogging: true,
                jwtScopes: CONTENT_TAG_DELETE_API_SCOPES[resourceType],
                callback: async (restApi) => {
                  const common = { siteId: restApi.siteId, tagLabel };
                  switch (resourceType) {
                    case 'workbook':
                      await restApi.workbooksMethods.deleteTagFromWorkbook({
                        ...common,
                        workbookId: resourceId,
                      });
                      break;
                    case 'view':
                      await restApi.viewsMethods.deleteTagFromView({
                        ...common,
                        viewId: resourceId,
                      });
                      break;
                    case 'datasource':
                      await restApi.datasourcesMethods.deleteTagFromDatasource({
                        ...common,
                        datasourceId: resourceId,
                      });
                      break;
                  }
                },
              }),
            true,
          );
          return new Ok({ resourceType, resourceId, removedTagLabel: tagLabel });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
