import { Ok, Result } from 'ts-results-es';

import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Subscription } from '../../../sdks/tableau/types/subscription.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

export const SUBSCRIPTIONS_PAGE_SIZE = 100;
export const subscriptionIdParamsSchema = {
  subscriptionId: luidSchema.describe(
    'The LUID of your subscription, returned by list-subscriptions or create-subscription.',
  ),
};

export function subscriptionError(
  message = 'The subscription is not owned by the authenticated user or its content is not accessible.',
): McpToolError {
  return new McpToolError({ type: 'subscription-not-allowed', statusCode: 403, message });
}

export async function getSubscriptionUserId(
  restApi: RestApi,
): Promise<Result<string, McpToolError>> {
  if (restApi.userId)
    return luidSchema.safeParse(restApi.userId).success
      ? new Ok(restApi.userId)
      : new ArgsValidationError(
          'The authenticated Tableau user ID is unavailable or invalid.',
        ).toErr();
  const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
  if (
    session.isErr() ||
    session.value.site.id !== restApi.siteId ||
    !luidSchema.safeParse(session.value.user.id).success
  )
    return new ArgsValidationError(
      'Could not verify the authenticated Tableau user on this site.',
    ).toErr();
  return new Ok(session.value.user.id);
}

export async function subscriptionContext(
  extra: TableauWebRequestHandlerExtra,
): Promise<TableauWebRequestHandlerExtra & { disableLogging: true }> {
  const config = await extra.getConfigWithOverrides();
  return { ...extra, disableLogging: true as const, getConfigWithOverrides: async () => config };
}

/** List probes reuse its read session; mutation probes finish before the mutation session starts. */
export async function subscriptionContentAllowed(
  content: Subscription['content'],
  extra: TableauWebRequestHandlerExtra,
  restApi?: RestApi,
): Promise<boolean> {
  const checked =
    content.type === 'Workbook'
      ? await resourceAccessChecker.isWorkbookAllowed({ workbookId: content.id, extra, restApi })
      : await resourceAccessChecker.isViewAllowed({ viewId: content.id, extra, restApi });
  if (!checked.allowed) return false;
  if (restApi && checked.content) return checked.content.id === content.id;
  // The shared checker can short-circuit when unrestricted. Still confirm current visibility.
  const checkVisibility = async (client: RestApi): Promise<boolean> => {
    try {
      const visible =
        content.type === 'Workbook'
          ? await client.workbooksMethods.getWorkbook({
              siteId: client.siteId,
              workbookId: content.id,
            })
          : await client.viewsMethods.getView({ siteId: client.siteId, viewId: content.id });
      return visible.id === content.id;
    } catch {
      return false;
    }
  };
  if (restApi) return checkVisibility(restApi);
  return useRestApi({
    ...extra,
    disableLogging: true,
    jwtScopes: ['tableau:content:read'],
    callback: checkVisibility,
  });
}

export function subscriptionMatches(
  subscription: Subscription,
  userId: string,
  content: Subscription['content'],
): boolean {
  return (
    subscription.user.id === userId &&
    subscription.content.id === content.id &&
    subscription.content.type === content.type
  );
}
