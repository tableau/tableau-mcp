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
    await this._apiClient.addGroupToGroupSet({
      params: { siteId, groupSetId, groupId },
      ...this.authHeader,
    });

  addUserToGroup = async (siteId: string, groupId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.addUserToGroup({
      params: { siteId, groupId },
      body,
      ...this.authHeader,
    });

  addUserToSite = async (siteId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.addUserToSite({
      params: { siteId },
      body,
      ...this.authHeader,
    });

  createGroup = async (
    siteId: string,
    body: unknown,
    queries?: { asJob?: boolean },
  ): Promise<unknown> =>
    await this._apiClient.createGroup({
      params: { siteId },
      queries,
      body,
      ...this.authHeader,
    });

  createGroupSet = async (siteId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.createGroupSet({
      params: { siteId },
      body,
      ...this.authHeader,
    });

  deleteGroup = async (siteId: string, groupId: string): Promise<unknown> =>
    await this._apiClient.deleteGroup({
      params: { siteId, groupId },
      ...this.authHeader,
    });

  deleteGroupSet = async (siteId: string, groupSetId: string): Promise<unknown> =>
    await this._apiClient.deleteGroupSet({
      params: { siteId, groupSetId },
      ...this.authHeader,
    });

  deleteUsersFromSiteWithCsv = async (siteId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.deleteUsersFromSiteWithCsv({
      params: { siteId },
      body,
      ...this.authHeader,
    });

  downloadUserCredentials = async (
    siteId: string,
    userId: string,
    body: unknown,
  ): Promise<unknown> =>
    await this._apiClient.downloadUserCredentials({
      params: { siteId, userId },
      body,
      ...this.authHeader,
    });

  getGroupsForUser = async (
    siteId: string,
    userId: string,
    queries?: PagingQuery,
  ): Promise<unknown> =>
    await this._apiClient.getGroupsForUser({
      params: { siteId, userId },
      queries,
      ...this.authHeader,
    });

  getGroupSet = async (siteId: string, groupSetId: string): Promise<unknown> =>
    await this._apiClient.getGroupSet({
      params: { siteId, groupSetId },
      ...this.authHeader,
    });

  getUsersInGroup = async (
    siteId: string,
    groupId: string,
    queries?: PagingQuery,
  ): Promise<unknown> =>
    await this._apiClient.getUsersInGroup({
      params: { siteId, groupId },
      queries,
      ...this.authHeader,
    });

  getUsersOnSite = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string; fields?: string },
  ): Promise<unknown> =>
    await this._apiClient.getUsersOnSite({
      params: { siteId },
      queries,
      ...this.authHeader,
    });

  importUsersToSiteFromCsv = async (
    siteId: string,
    body: unknown,
    queries?: { isVerbose?: boolean },
  ): Promise<unknown> =>
    await this._apiClient.importUsersToSiteFromCsv({
      params: { siteId },
      queries,
      body,
      ...this.authHeader,
    });

  listGroupSets = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string },
  ): Promise<unknown> =>
    await this._apiClient.listGroupSets({
      params: { siteId },
      queries,
      ...this.authHeader,
    });

  queryGroups = async (
    siteId: string,
    queries?: PagingQuery & { filter?: string; sort?: string },
  ): Promise<unknown> =>
    await this._apiClient.queryGroups({
      params: { siteId },
      queries,
      ...this.authHeader,
    });

  queryUserOnSite = async (siteId: string, userId: string): Promise<unknown> =>
    await this._apiClient.queryUserOnSite({
      params: { siteId, userId },
      ...this.authHeader,
    });

  removeGroupFromGroupSet = async (
    siteId: string,
    groupSetId: string,
    groupId: string,
  ): Promise<unknown> =>
    await this._apiClient.removeGroupFromGroupSet({
      params: { siteId, groupSetId, groupId },
      ...this.authHeader,
    });

  removeUserFromSite = async (
    siteId: string,
    userId: string,
    queries?: { mapAssetsTo?: string },
  ): Promise<unknown> =>
    await this._apiClient.removeUserFromSite({
      params: { siteId, userId },
      queries,
      ...this.authHeader,
    });

  removeUserFromGroup = async (siteId: string, groupId: string, userId: string): Promise<unknown> =>
    await this._apiClient.removeUserFromGroup({
      params: { siteId, groupId, userId },
      ...this.authHeader,
    });

  bulkRemoveUsersFromGroup = async (
    siteId: string,
    groupId: string,
    body: unknown,
  ): Promise<unknown> =>
    await this._apiClient.bulkRemoveUsersFromGroup({
      params: { siteId, groupId },
      body,
      ...this.authHeader,
    });

  updateGroup = async (
    siteId: string,
    groupId: string,
    body: unknown,
    queries?: { asJob?: boolean },
  ): Promise<unknown> =>
    await this._apiClient.updateGroup({
      params: { siteId, groupId },
      queries,
      body,
      ...this.authHeader,
    });

  updateGroupSet = async (siteId: string, groupSetId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.updateGroupSet({
      params: { siteId, groupSetId },
      body,
      ...this.authHeader,
    });

  updateUser = async (siteId: string, userId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.updateUser({
      params: { siteId, userId },
      body,
      ...this.authHeader,
    });

  uploadUserCredentials = async (siteId: string, userId: string, body: unknown): Promise<unknown> =>
    await this._apiClient.uploadUserCredentials({
      params: { siteId, userId },
      body,
      ...this.authHeader,
    });
}
