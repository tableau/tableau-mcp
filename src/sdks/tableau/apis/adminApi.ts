import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { paginationParameters } from './paginationParameters.js';

const anyResponse = z.any();
const siteIdPathParameter = {
  name: 'siteId',
  type: 'Path' as const,
  schema: z.string(),
};
const groupIdPathParameter = {
  name: 'groupId',
  type: 'Path' as const,
  schema: z.string(),
};
const groupSetIdPathParameter = {
  name: 'groupSetId',
  type: 'Path' as const,
  schema: z.string(),
};
const userIdPathParameter = {
  name: 'userId',
  type: 'Path' as const,
  schema: z.string(),
};

const adminApi = makeApi([
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/groupsets/:groupSetId/groups/:groupId',
    alias: 'addGroupToGroupSet',
    description: 'Adds group to a group set.',
    parameters: [siteIdPathParameter, groupSetIdPathParameter, groupIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/groups/:groupId/users',
    alias: 'addUserToGroup',
    description: 'Adds one or more users to a group.',
    parameters: [
      siteIdPathParameter,
      groupIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/users',
    alias: 'addUserToSite',
    description: 'Adds a user to a site.',
    parameters: [siteIdPathParameter, { name: 'body', type: 'Body', schema: z.any() }],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/groups',
    alias: 'createGroup',
    description: 'Creates a group on a site.',
    parameters: [
      siteIdPathParameter,
      {
        name: 'asJob',
        type: 'Query',
        schema: z.boolean().optional(),
      },
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/groupsets',
    alias: 'createGroupSet',
    description: 'Creates a group set.',
    parameters: [siteIdPathParameter, { name: 'body', type: 'Body', schema: z.any() }],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'delete',
    path: '/sites/:siteId/groups/:groupId',
    alias: 'deleteGroup',
    description: 'Deletes a group.',
    parameters: [siteIdPathParameter, groupIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'delete',
    path: '/sites/:siteId/groupsets/:groupSetId',
    alias: 'deleteGroupSet',
    description: 'Deletes a group set.',
    parameters: [siteIdPathParameter, groupSetIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/users/delete',
    alias: 'deleteUsersFromSiteWithCsv',
    description: 'Deletes users from site via CSV multipart upload.',
    parameters: [siteIdPathParameter, { name: 'body', type: 'Body', schema: z.any() }],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/users/:userId/retrieveSavedCreds',
    alias: 'downloadUserCredentials',
    description: 'Downloads user credentials for migration.',
    parameters: [
      siteIdPathParameter,
      userIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/users/:userId/groups',
    alias: 'getGroupsForUser',
    description: 'Gets groups for a user.',
    parameters: [siteIdPathParameter, userIdPathParameter, ...paginationParameters],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/groupsets/:groupSetId',
    alias: 'getGroupSet',
    description: 'Gets a group set.',
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/groups/:groupId/users',
    alias: 'getUsersInGroup',
    description: 'Gets users in a group.',
    parameters: [siteIdPathParameter, groupIdPathParameter, ...paginationParameters],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/users',
    alias: 'getUsersOnSite',
    description: 'Gets users on a site.',
    parameters: [
      siteIdPathParameter,
      ...paginationParameters,
      { name: 'filter', type: 'Query', schema: z.string().optional() },
      { name: 'sort', type: 'Query', schema: z.string().optional() },
      { name: 'fields', type: 'Query', schema: z.string().optional() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'post',
    path: '/sites/:siteId/users/import',
    alias: 'importUsersToSiteFromCsv',
    description: 'Imports users to site from CSV multipart upload.',
    parameters: [
      siteIdPathParameter,
      { name: 'isVerbose', type: 'Query', schema: z.boolean().optional() },
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/groupsets',
    alias: 'listGroupSets',
    description: 'Lists group sets.',
    parameters: [
      siteIdPathParameter,
      ...paginationParameters,
      { name: 'filter', type: 'Query', schema: z.string().optional() },
      { name: 'sort', type: 'Query', schema: z.string().optional() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/groups',
    alias: 'queryGroups',
    description: 'Queries groups.',
    parameters: [
      siteIdPathParameter,
      ...paginationParameters,
      { name: 'filter', type: 'Query', schema: z.string().optional() },
      { name: 'sort', type: 'Query', schema: z.string().optional() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'get',
    path: '/sites/:siteId/users/:userId',
    alias: 'queryUserOnSite',
    description: 'Queries a user on site.',
    parameters: [siteIdPathParameter, userIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'delete',
    path: '/sites/:siteId/groupsets/:groupSetId/groups/:groupId',
    alias: 'removeGroupFromGroupSet',
    description: 'Removes a group from group set.',
    parameters: [siteIdPathParameter, groupSetIdPathParameter, groupIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'delete',
    path: '/sites/:siteId/users/:userId',
    alias: 'removeUserFromSite',
    description: 'Removes user from site.',
    parameters: [
      siteIdPathParameter,
      userIdPathParameter,
      { name: 'mapAssetsTo', type: 'Query', schema: z.string().optional() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'delete',
    path: '/sites/:siteId/groups/:groupId/users/:userId',
    alias: 'removeUserFromGroup',
    description: 'Removes one user from group.',
    parameters: [siteIdPathParameter, groupIdPathParameter, userIdPathParameter],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/groups/:groupId/users/remove',
    alias: 'bulkRemoveUsersFromGroup',
    description: 'Bulk removes users from group.',
    parameters: [
      siteIdPathParameter,
      groupIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/groups/:groupId',
    alias: 'updateGroup',
    description: 'Updates a group.',
    parameters: [
      siteIdPathParameter,
      groupIdPathParameter,
      { name: 'asJob', type: 'Query', schema: z.boolean().optional() },
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/groupsets/:groupSetId',
    alias: 'updateGroupSet',
    description: 'Updates a group set.',
    parameters: [
      siteIdPathParameter,
      groupSetIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/users/:userId',
    alias: 'updateUser',
    description: 'Updates a user.',
    parameters: [
      siteIdPathParameter,
      userIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
  makeEndpoint({
    method: 'put',
    path: '/sites/:siteId/users/:userId/uploadSavedCreds',
    alias: 'uploadUserCredentials',
    description: 'Uploads user credentials to destination site.',
    parameters: [
      siteIdPathParameter,
      userIdPathParameter,
      { name: 'body', type: 'Body', schema: z.any() },
    ],
    response: anyResponse,
  }),
]);

export const adminApis = [...adminApi] as const satisfies ZodiosEndpointDefinitions;
