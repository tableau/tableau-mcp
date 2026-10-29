import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { RecentContent, recentContentSchema } from '../../../sdks/tableau/types/recentContent.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

const paramsSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe('Maximum allowed recent items to return, from 1 to 24 (default 24).'),
};

/** Lists the authenticated user's supported recent content without changing their history. */
export const getListRecentContentTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listRecentContentTool = new WebTool({
    server,
    name: 'list-recent-content',
    minRequiredRole: SiteRole.VIEWER,
    description: `Retrieves the signed-in user's recent views and workbooks on the current Tableau site using Get Recently Viewed for Site (GET /api/{version}/sites/{siteId}/content/recent, REST API 3.5+).
Returns an ordered array of { view: metadata } or { workbook: metadata } entries after server-configured resource restrictions. The API window contains at most 24 items recently created, updated, or accessed by this user and may lag several minutes. Optional limit is an integer from 1 to 24, default 24, and is applied after resource restrictions along with MAX_RESULT_LIMIT/MAX_RESULT_LIMITS.
Use this tool to revisit your own recent content. Use search-content for relevance/popularity discovery or list-views/list-workbooks for general listings. It does not support another user, pagination, sorting, or date filters, and does not reproduce the full UI Recents experience or include flows. createdAt/updatedAt describe content changes; no last-viewed/access timestamp is returned.`,
    paramsSchema,
    annotations: {
      title: 'List Recent Content',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ limit }, extra): Promise<CallToolResult> =>
      await listRecentContentTool.logAndExecute({
        extra,
        args: { limit },
        callback: async () => {
          const config = await extra.getConfigWithOverrides();
          // Raw REST response notifications run before bounded filtering. Keep this request's
          // listing and access-check probes quiet while preserving WebTool audit logging above.
          // Each existing checker probe spreads extra into useRestApi, forwarding this flag.
          const quietExtra: TableauWebRequestHandlerExtra & { disableLogging: true } = {
            ...extra,
            disableLogging: true,
          };
          const recentContent = await useRestApi({
            ...extra,
            disableLogging: true,
            // Settings and access-check probes use separate sessions with their own scopes.
            jwtScopes: ['tableau:content:read'],
            callback: async (restApi) => {
              if (!RestApi.versionIsAtLeast('3.5')) {
                throw new Error(
                  'Recently viewed content requires Tableau REST API version 3.5 or later.',
                );
              }
              return await restApi.recentContentMethods.getRecentlyViewedForSite({
                siteId: restApi.siteId,
              });
            },
          });

          const parsed = z.array(recentContentSchema).safeParse(recentContent);
          if (!parsed.success) {
            throw new Error('Tableau returned an invalid recent-content response.');
          }

          const allowedContent: RecentContent[] = [];
          for (const recent of parsed.data) {
            const access =
              'view' in recent
                ? await resourceAccessChecker.isViewAllowed({
                    viewId: recent.view.id,
                    extra: quietExtra,
                  })
                : await resourceAccessChecker.isWorkbookAllowed({
                    workbookId: recent.workbook.id,
                    extra: quietExtra,
                  });
            if (access.allowed) {
              allowedContent.push(recent);
            }
          }

          const maxResultLimit = config.getMaxResultLimit(listRecentContentTool.name);
          const effectiveLimit = Math.min(limit ?? 24, maxResultLimit ?? 24);
          // Preserve the mixed backend order. Denied rows never consume either result limit.
          return new Ok(allowedContent.slice(0, effectiveLimit));
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });

  return listRecentContentTool;
};
