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
          const maxResultLimit = config.getMaxResultLimit(listRecentContentTool.name);
          const effectiveLimit = Math.min(limit ?? 24, maxResultLimit ?? 24);
          // Raw REST response notifications run before bounded filtering. Keep this request's
          // listing and access-check probes quiet while preserving WebTool audit logging above.
          // Every checker reuses this request's already-resolved configuration snapshot.
          const quietExtra: TableauWebRequestHandlerExtra & { disableLogging: true } = {
            ...extra,
            disableLogging: true,
            getConfigWithOverrides: async () => config,
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

          const parsed = z.array(recentContentSchema).max(24).safeParse(recentContent);
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
              if (allowedContent.length >= effectiveLimit) break;
            }
          }

          // Preserve the mixed backend order. Denied rows never consume either result limit, and
          // no additional authorization probes run after the effective limit is filled.
          return new Ok(allowedContent);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });

  return listRecentContentTool;
};
