import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  Subscription,
  subscriptionContentTypeSchema,
} from '../../../sdks/tableau/types/subscription.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES } from '../../../server/oauth/scopes.js';
import { WebTool } from '../tool.js';
import {
  getSubscriptionUserId,
  subscriptionContentAllowed,
  subscriptionContext,
  SUBSCRIPTIONS_PAGE_SIZE,
} from './subscriptionUtils.js';

const paramsSchema = {
  pageNumber: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER / SUBSCRIPTIONS_PAGE_SIZE)
    .optional()
    .describe('The 1-based 100-item source page to inspect (default 1).'),
  limit: z
    .number()
    .int()
    .positive()
    .max(SUBSCRIPTIONS_PAGE_SIZE)
    .optional()
    .describe(
      'Maximum subscriptions returned from this source page, at most 100. This does not change page boundaries.',
    ),
  contentType: subscriptionContentTypeSchema
    .optional()
    .describe('Optionally show only Workbook or View subscriptions.'),
  contentId: luidSchema
    .optional()
    .describe('Optionally show only subscriptions for this content LUID.'),
};

export const getListSubscriptionsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool: WebTool<typeof paramsSchema> = new WebTool({
    server,
    name: 'list-subscriptions',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Lists your workbook/view email subscriptions, including their suspension state. Returns one 100-item source page after ownership, optional content filters, visibility, and configured content limits are applied. A page can be empty while nextPageNumber is present. Follow nextPageNumber to continue; other users subscriptions and site-wide totals are never returned. A small limit truncates this page, so omit it to inspect every matching subscription on the page. Pulse subscriptions use list-pulse-metric-subscriptions.',
    paramsSchema,
    annotations: {
      title: 'List Subscriptions',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra) =>
      tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const quiet = await subscriptionContext(extra);
          const config = await quiet.getConfigWithOverrides();
          const cap = config.getMaxResultLimit(tool.name);
          const pageNumber = args.pageNumber ?? 1;
          const offset = (pageNumber - 1) * SUBSCRIPTIONS_PAGE_SIZE;
          if (cap !== null && offset >= cap)
            return new PageExceedsLimitError(
              'The requested subscriptions page exceeds the configured result limit.',
            ).toErr();
          const limit = Math.min(
            args.limit ?? SUBSCRIPTIONS_PAGE_SIZE,
            cap === null ? SUBSCRIPTIONS_PAGE_SIZE : cap - offset,
          );
          return useRestApi({
            ...quiet,
            jwtScopes: ['tableau:tasks:read', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES],
            callback: async (restApi) => {
              const user = await getSubscriptionUserId(restApi);
              if (user.isErr()) return user;
              const page = await restApi.subscriptionsMethods.querySubscriptions({
                siteId: restApi.siteId,
                pageNumber,
                pageSize: SUBSCRIPTIONS_PAGE_SIZE,
              });
              if (page.isErr()) return page;
              const subscriptions: Subscription[] = [];
              const candidates = page.value.subscriptions.filter(
                (subscription) =>
                  subscription.user.id === user.value &&
                  (!args.contentType || subscription.content.type === args.contentType) &&
                  (!args.contentId || subscription.content.id === args.contentId),
              );
              const access = new Map<string, boolean>();
              for (const subscription of candidates) {
                if (subscriptions.length >= limit) break;
                const key = `${subscription.content.type}:${subscription.content.id}`;
                let allowed = access.get(key);
                if (allowed === undefined) {
                  allowed = await subscriptionContentAllowed(subscription.content, quiet, restApi);
                  access.set(key, allowed);
                }
                if (allowed) subscriptions.push(subscription);
              }
              const hasMore =
                offset + SUBSCRIPTIONS_PAGE_SIZE < page.value.pagination.totalAvailable &&
                (cap === null || offset + SUBSCRIPTIONS_PAGE_SIZE < cap);
              return new Ok({
                subscriptions,
                pageNumber,
                pageSize: SUBSCRIPTIONS_PAGE_SIZE,
                hasMore,
                ...(hasMore && { nextPageNumber: pageNumber + 1 }),
                pageTruncated:
                  subscriptions.length === limit && candidates.length > subscriptions.length,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
