import { ZodiosError } from '@zodios/core';
import { isZodErrorLike } from 'zod-validation-error/v3';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { recentContentApis } from '../apis/recentContentApi.js';
import { RestApiCredentials } from '../restApi.js';
import { RecentContent, recentContentResponseSchema } from '../types/recentContent.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/** Read-only recent content for the authenticated user, using the versioned Tableau REST API. */
export default class RecentContentMethods extends AuthenticatedMethods<typeof recentContentApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, recentContentApis, { axiosConfig }), creds);
  }

  /**
   * Gets up to 24 views/workbooks recently created, updated, or accessed by the signed-in user.
   * No user selector, pagination, sort, or date filter is supported by this endpoint.
   * Requires API 3.5+ and `tableau:content:read` for JWT authorization (Cloud 3.16+/Server 3.17+).
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_site.htm#get_recently_viewed_for_site
   */
  getRecentlyViewedForSite = async ({ siteId }: { siteId: string }): Promise<RecentContent[]> => {
    try {
      const response = await this._apiClient.getRecentlyViewedForSite({
        params: { siteId },
        ...this.authHeader,
      });
      // Zodios validates JSON media types only. Validate again so a missing/misreported media
      // type cannot bypass this response contract before rows reach the access checker.
      const parsed = recentContentResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error('Tableau returned an invalid recent-content response.');
      }
      return parsed.data.recents.recent ?? [];
    } catch (error) {
      if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
        // Do not pass raw invalid rows through the tool's schema-warning/error path: none have
        // passed bounded-context checks yet, and the response may contain unsupported resources.
        throw new Error('Tableau returned an invalid recent-content response.');
      }
      throw error;
    }
  };
}
