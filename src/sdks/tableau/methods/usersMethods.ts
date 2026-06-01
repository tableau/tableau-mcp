import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { usersApis } from '../apis/usersApi.js';
import { RestApiCredentials } from '../restApi.js';
import { User } from '../types/user.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Users and Groups methods of the Tableau Server REST API
 *
 * @export
 * @class UsersMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm
 */
export default class UsersMethods extends AuthenticatedMethods<typeof usersApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, usersApis, { axiosConfig }), creds);
  }

  /**
   * Returns a list of users on the site.
   * Passes includeSSOInfo=false, includeUserCount=false, includeGroups=false
   * by default to minimize DB and SAML DDB load on large sites.
   *
   * Required scopes (Tableau Cloud): `tableau:users:read`
   *
   * @param siteId - The Tableau site ID
   * @param pageSize - Number of users per page (default 100, max 1000)
   * @param pageNumber - Page offset (default 1)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site
   */
  listUsers = async ({
    siteId,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<User[]> => {
    const response = await this._apiClient.listUsers({
      params: { siteId },
      queries: {
        pageSize,
        pageNumber,
        includeSSOInfo: false,
        includeUserCount: false,
        includeGroups: false,
      },
      ...this.authHeader,
    });
    return response.users.user;
  };

  /**
   * Returns information about the specified user.
   *
   * Required scopes (Tableau Cloud): `tableau:users:read`
   *
   * @param siteId - The Tableau site ID
   * @param userId - The user ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site
   */
  queryUserOnSite = async ({
    siteId,
    userId,
  }: {
    siteId: string;
    userId: string;
  }): Promise<User> => {
    const { user } = await this._apiClient.getUserOnSite({
      params: { siteId, userId },
      ...this.authHeader,
    });
    return user;
  };
}
