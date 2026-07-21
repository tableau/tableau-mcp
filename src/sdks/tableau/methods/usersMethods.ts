import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { usersApis } from '../apis/usersApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination } from '../types/pagination.js';
import { User } from '../types/user.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export interface ListUsersResult {
  users: User[];
  pagination?: Pagination;
}

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
   * Returns a list of users on the site with pagination metadata.
   *
   * Required scopes (Tableau Cloud): `tableau:users:read`
   *
   * @param siteId - The Tableau site ID
   * @param pageSize - Number of users per page (default 100, max 1000)
   * @param pageNumber - Page offset (default 1)
   * @param includeUserCount - Include total user count in pagination metadata
   * @param includeSSOInfo - Include SSO/SAML info per user
   * @param includeGroups - Include group memberships per user
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site
   */
  listUsers = async ({
    siteId,
    pageSize,
    pageNumber,
    includeUserCount,
    includeSSOInfo,
    includeGroups,
  }: {
    siteId: string;
    pageSize?: number;
    pageNumber?: number;
    includeUserCount?: boolean;
    includeSSOInfo?: boolean;
    includeGroups?: boolean;
  }): Promise<ListUsersResult> => {
    const response = await this._apiClient.listUsers({
      params: { siteId },
      queries: {
        pageSize,
        pageNumber,
        includeUserCount,
        includeSSOInfo,
        includeGroups,
      },
      ...this.authHeader,
    });
    return {
      users: response.users.user,
      pagination: response.pagination,
    };
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

  /**
   * Updates the site role for the specified user.
   *
   * Required scopes (Tableau Cloud): `tableau:users:update`
   *
   * @param siteId - The Tableau site ID
   * @param userId - The user ID
   * @param siteRole - The new site role to assign
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user
   */
  updateUser = async ({
    siteId,
    userId,
    siteRole,
  }: {
    siteId: string;
    userId: string;
    siteRole: string;
  }): Promise<Partial<User>> => {
    const { user } = await this._apiClient.updateUser(
      { user: { siteRole } },
      {
        params: { siteId, userId },
        ...this.authHeader,
      },
    );
    return user;
  };
}
