import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { sitesApis } from '../apis/sitesApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Site } from '../types/site.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Site methods of the Tableau Server REST API
 *
 * @export
 * @class SitesMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_sites.htm
 */
export default class SitesMethods extends AuthenticatedMethods<typeof sitesApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, sitesApis, { axiosConfig }), creds);
  }

  /**
   * Returns information about the specified site.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   */
  getSite = async ({ siteId }: { siteId: string }): Promise<Site> => {
    return (
      await this._apiClient.getSite({
        params: { siteId },
        ...this.authHeader,
      })
    ).site;
  };
}
