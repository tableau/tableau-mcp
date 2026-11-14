import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  workbookId: luidSchema.describe('The LUID of the workbook whose revision history to list.'),
  pageSize: z.number().int().min(1).max(1000).default(100).describe('Revisions per page (1–1000).'),
  pageNumber: z.number().int().min(1).default(1).describe('The page number, starting at 1.'),
};

/** Lists one server page; deleted and current markers are preserved for the caller. */
export const getListWorkbookRevisionsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'list-workbook-revisions',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Lists a page of workbook revision history, including revision numbers and current/deleted markers when available. Requires site revision history and permission to download revisions. Use download-workbook-revision for a past revision; use download-workbook for the current revision.',
    paramsSchema,
    annotations: {
      title: 'List Workbook Revisions',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookId, pageSize = 100, pageNumber = 1 },
      extra,
    ): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args: { workbookId, pageSize, pageNumber },
        callback: async () => {
          const allowed = await resourceAccessChecker.isWorkbookAllowed({ workbookId, extra });
          if (!allowed.allowed) return new WorkbookNotAllowedError(allowed.message).toErr();
          const result = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.getWorkbookRevisions({
                siteId: restApi.siteId,
                workbookId,
                pageSize,
                pageNumber,
              }),
          });
          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
