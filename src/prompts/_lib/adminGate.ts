import { RestApi } from '../../sdks/tableau/restApi.js';
import { isAdminSiteRole } from '../../sdks/tableau/types/user.js';

export class NotAdminError extends Error {
  constructor(siteRole: string | undefined) {
    const observed = siteRole ?? 'unknown';
    super(
      'This tool is restricted to Tableau site administrators. ' +
        `The caller's site role is "${observed}", which does not have permission to invoke admin-only tooling.`,
    );
    this.name = 'NotAdminError';
  }
}

const cache: Map<string, { siteRole: string | undefined; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

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
      cache.set(cacheKey, { siteRole, expiresAt: now + CACHE_TTL_MS });
    }

    if (!isAdminSiteRole(siteRole)) {
      throw new NotAdminError(siteRole);
    }
  },

  clearCache(): void {
    cache.clear();
  },
};
