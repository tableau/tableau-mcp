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
   * Returns information about the specified user.
   *
   * @param siteId - The Tableau site ID
   * @param userId - The user ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site
   */
  getUser = async ({ siteId, userId }: { siteId: string; userId: string }): Promise<User> => {
    const { user } = await this._apiClient.getUserOnSite({
      params: { siteId, userId },
      ...this.authHeader,
    });
    return user;
  };
}
