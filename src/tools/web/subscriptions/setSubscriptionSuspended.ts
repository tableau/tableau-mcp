import { Ok } from 'ts-results-es';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import {
  getSubscriptionUserId,
  subscriptionContentAllowed,
  subscriptionContext,
  subscriptionError,
  subscriptionIdParamsSchema,
  subscriptionMatches,
} from './subscriptionUtils.js';

/** Shared lifecycle keeps owner, content, identity, and idempotency checks identical. */
export function getSetSubscriptionSuspendedTool(
  server: WebMcpServer,
  suspended: boolean,
): WebTool<typeof subscriptionIdParamsSchema> {
  const tool: WebTool<typeof subscriptionIdParamsSchema> = new WebTool({
    server,
    name: suspended ? 'suspend-subscription' : 'resume-subscription',
    minRequiredRole: SiteRole.VIEWER,
    description: suspended
      ? 'Pauses your workbook/view email subscription. Preserves the subscription and its schedule; it can be resumed later. Requires current content access and ownership.'
      : 'Resumes your workbook/view email subscription so scheduled email delivery can run again. Preserves its existing schedule. Requires current content access and ownership.',
    paramsSchema: subscriptionIdParamsSchema,
    annotations: {
      title: suspended ? 'Suspend Subscription' : 'Resume Subscription',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async (args, extra) =>
      tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const quiet = await subscriptionContext(extra);
          const snapshot = await useRestApi({
            ...quiet,
            jwtScopes: ['tableau:tasks:read'],
            callback: async (restApi) => {
              const user = await getSubscriptionUserId(restApi);
              if (user.isErr()) return user;
              const result = await restApi.subscriptionsMethods.getSubscription({
                siteId: restApi.siteId,
                subscriptionId: args.subscriptionId,
              });
              if (result.isErr()) return result;
              if (result.value.id !== args.subscriptionId || result.value.user.id !== user.value)
                return subscriptionError().toErr();
              return new Ok(result.value);
            },
          });
          if (snapshot.isErr()) return snapshot;
          if (!(await subscriptionContentAllowed(snapshot.value.content, quiet)))
            return subscriptionError().toErr();
          return useRestApi({
            ...quiet,
            jwtScopes: ['tableau:tasks:read', 'tableau:tasks:update'],
            callback: async (restApi) => {
              const user = await getSubscriptionUserId(restApi);
              if (user.isErr()) return user;
              const current = await restApi.subscriptionsMethods.getSubscription({
                siteId: restApi.siteId,
                subscriptionId: args.subscriptionId,
              });
              if (current.isErr()) return current;
              if (
                current.value.id !== args.subscriptionId ||
                user.value !== snapshot.value.user.id ||
                !subscriptionMatches(current.value, user.value, snapshot.value.content)
              )
                return subscriptionError().toErr();
              if (current.value.suspended === suspended) return new Ok(current.value);
              const result = await restApi.subscriptionsMethods.setSuspended({
                siteId: restApi.siteId,
                subscriptionId: args.subscriptionId,
                suspended,
              });
              if (result.isErr()) return result;
              if (
                result.value.id !== args.subscriptionId ||
                !subscriptionMatches(result.value, user.value, current.value.content) ||
                result.value.suspended !== suspended
              )
                return subscriptionError(
                  'The update response did not confirm the requested subscription state. Inspect your subscriptions before retrying.',
                ).toErr();
              return new Ok(result.value);
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
}
