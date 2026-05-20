import { AdminOnlyError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ADMIN_SITE_ROLES = new Set([
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'ServerAdministrator',
]);

function isAdminSiteRole(siteRole: string | undefined): boolean {
  return !!siteRole && ADMIN_SITE_ROLES.has(siteRole);
}

export class NotAdminError extends AdminOnlyError {
  constructor(siteRole: string | undefined) {
    const message = siteRole
      ? `This tool requires site administrator permissions. Your site role is: ${siteRole}`
      : 'This tool requires site administrator permissions';
    super(message);
  }
}

interface CachedRole {
  siteRole: string;
  expiresAt: number;
}

const cache = new Map<string, CachedRole>();

export const adminGate = {
  async assertAdmin(restApi: RestApi): Promise<void> {
    const siteId = restApi.siteId;
    const userId = restApi.userId;
    if (!userId) {
      throw new NotAdminError(undefined);
    }

    const cacheKey = `${siteId}:${userId}`;
    const cached = cache.get(cacheKey);
    const now = Date.now();
    let siteRole: string | undefined;

    if (cached && cached.expiresAt > now) {
      siteRole = cached.siteRole;
    } else {
      const user = await restApi.usersMethods.getUser({ siteId, userId });
      siteRole = user.siteRole;
      cache.set(cacheKey, { siteRole: siteRole ?? '', expiresAt: now + CACHE_TTL_MS });
    }

    if (!isAdminSiteRole(siteRole)) {
      throw new NotAdminError(siteRole);
    }
  },

  clearCache(): void {
    cache.clear();
  },
};
