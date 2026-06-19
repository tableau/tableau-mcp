import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';

/**
 * Best-effort resolution of a content owner's email for preview/notify reporting. Owner lookup is
 * informational only (report-only notify), so a failure must not block the caller — we log and fall
 * back to no email. Falls back to the owner's name (the login/username, an email on Tableau Cloud)
 * when no email field is returned.
 *
 * Shared by the delete tools (delete-workbook, delete-datasource) so the resolution behavior stays
 * identical across the destructive Apply surface.
 */
export async function resolveOwnerEmail(
  restApi: RestApi,
  siteId: string,
  ownerId: string | undefined,
  logger = 'resolve-owner-email',
): Promise<string | null> {
  if (!ownerId) {
    return null;
  }
  try {
    const owner = await restApi.usersMethods.queryUserOnSite({ siteId, userId: ownerId });
    return owner.email ?? owner.name ?? null;
  } catch (error) {
    log({
      message: `${logger}: failed to resolve owner ${ownerId}`,
      level: 'warning',
      logger,
      data: getExceptionMessage(error),
    });
    return null;
  }
}
