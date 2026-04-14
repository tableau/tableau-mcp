import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { adminApis } from '../apis/adminApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

type PagingQuery = {
  pageSize?: number;
  pageNumber?: number;
};

export default class AdminMethods extends AuthenticatedMethods<typeof adminApis> {
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, adminApis, { axiosConfig }), creds);
  }

  addGroupToGroupSet = async (
    siteId: string,
    groupSetId: string,
    groupId: string,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.put(
        `/sites/${siteId}/groupsets/${groupSetId}/groups/${groupId}`,
        undefined,
        { ...this.authHeader },
      )
    ).data;

  addUserToGroup = async (siteId: string, groupId: string, body: unknown): Promise<unknown> =>
    (
      await this._apiClient.axios.post(
        `/sites/${siteId}/groups/${groupId}/users`,
        body,
        this.authHeader,
      )
    ).data;

  addUserToSite = async (siteId: string, body: unknown): Promise<unknown> =>
    await (async () => {
      const url = `/sites/${siteId}/users`;
      console.warn('Constructing URL:', {
        method: 'POST',
        operation: 'add-user-to-site',
        siteId,
        url,
      });
      const response = await this._apiClient.axios.post(url, body, {
        ...this.authHeader,
      });
      return response.data;
    })();

  createGroup = async (
    siteId: string,
    body: unknown,
    queries?: { asJob?: boolean },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.post(`/sites/${siteId}/groups`, body, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  createGroupSet = async (siteId: string, body: unknown): Promise<unknown> =>
    (await this._apiClient.axios.post(`/sites/${siteId}/groupsets`, body, this.authHeader)).data;

  deleteGroup = async (siteId: string, groupId: string): Promise<unknown> =>
    (await this._apiClient.axios.delete(`/sites/${siteId}/groups/${groupId}`, this.authHeader))
      .data;

  deleteGroupSet = async (siteId: string, groupSetId: string): Promise<unknown> =>
    (
      await this._apiClient.axios.delete(
        `/sites/${siteId}/groupsets/${groupSetId}`,
        this.authHeader,
      )
    ).data;

  deleteUsersFromSiteWithCsv = async (siteId: string, body: unknown): Promise<unknown> =>
    (await this._apiClient.axios.post(`/sites/${siteId}/users/delete`, body, this.authHeader)).data;

  downloadUserCredentials = async (
    siteId: string,
    userId: string,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.post(
        `/sites/${siteId}/users/${userId}/retrieveSavedCreds`,
        body,
        this.authHeader,
      )
    ).data;

  getGroupsForUser = async (
    siteId: string,
    userId: string,
    queries?: PagingQuery,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/users/${userId}/groups`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  getGroupSet = async (siteId: string, groupSetId: string): Promise<unknown> =>
    (await this._apiClient.axios.get(`/sites/${siteId}/groupsets/${groupSetId}`, this.authHeader))
      .data;

  getUsersInGroup = async (
    siteId: string,
    groupId: string,
    queries?: PagingQuery,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/groups/${groupId}/users`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  getUsersOnSite = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string; fields?: string },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/users`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  importUsersToSiteFromCsv = async (
    siteId: string,
    body: unknown,
    queries?: { isVerbose?: boolean },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.post(`/sites/${siteId}/users/import`, body, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  listGroupSets = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/groupsets`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  queryGroups = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/groups`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  queryUserOnSite = async (siteId: string, userId: string): Promise<unknown> =>
    (await this._apiClient.axios.get(`/sites/${siteId}/users/${userId}`, this.authHeader)).data;

  removeGroupFromGroupSet = async (
    siteId: string,
    groupSetId: string,
    groupId: string,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.delete(
        `/sites/${siteId}/groupsets/${groupSetId}/groups/${groupId}`,
        this.authHeader,
      )
    ).data;

  removeUserFromSite = async (
    siteId: string,
    userId: string,
    queries?: { mapAssetsTo?: string },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.delete(`/sites/${siteId}/users/${userId}`, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  removeUserFromGroup = async (siteId: string, groupId: string, userId: string): Promise<unknown> =>
    (
      await this._apiClient.axios.delete(
        `/sites/${siteId}/groups/${groupId}/users/${userId}`,
        this.authHeader,
      )
    ).data;

  bulkRemoveUsersFromGroup = async (
    siteId: string,
    groupId: string,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.put(
        `/sites/${siteId}/groups/${groupId}/users/remove`,
        body,
        this.authHeader,
      )
    ).data;

  updateGroup = async (
    siteId: string,
    groupId: string,
    body: unknown,
    queries?: { asJob?: boolean },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.put(`/sites/${siteId}/groups/${groupId}`, body, {
        ...this.authHeader,
        params: queries,
      })
    ).data;

  updateGroupSet = async (siteId: string, groupSetId: string, body: unknown): Promise<unknown> =>
    (
      await this._apiClient.axios.put(
        `/sites/${siteId}/groupsets/${groupSetId}`,
        body,
        this.authHeader,
      )
    ).data;

  updateUser = async (siteId: string, userId: string, body: unknown): Promise<unknown> =>
    (
      await this._apiClient.axios.put(`/sites/${siteId}/users/${userId}`, body, {
        ...this.authHeader,
      })
    ).data;

  uploadUserCredentials = async (siteId: string, userId: string, body: unknown): Promise<unknown> =>
    (
      await this._apiClient.axios.put(`/sites/${siteId}/users/${userId}/uploadSavedCreds`, body, {
        ...this.authHeader,
      })
    ).data;
}
