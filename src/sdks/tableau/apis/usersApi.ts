import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { pathParam } from '../../routeSafety/ids.js';
import { groupSchema } from '../types/group.js';
import { paginationSchema } from '../types/pagination.js';
import { userSchema } from '../types/user.js';

/**
 * Tableau API response schema with transform to normalize different response shapes:
 * - `{ users: { user: [...] } }` → normalized to `{ users: { user: [...] } }`
 * - `{ users: { user: {...} } }` → normalized to `{ users: { user: [{...}] } }`
 * - `{ users: [...] }` → normalized to `{ users: { user: [...] } }`
 * - `{ users: {} }` → normalized to `{ users: { user: [] } }`
 */
const listUsersBodySchema = z.object({
  pagination: paginationSchema.optional(),
  users: z.union([
    z.object({
      user: z.union([z.array(userSchema), userSchema.transform((user) => [user])]),
    }),
    z.array(userSchema).transform((users) => ({ user: users })),
    z.object({}).transform(() => ({ user: [] })),
  ]),
});

export type ListUsersBody = z.infer<typeof listUsersBodySchema>;

/**
 * Query Users on Site
 * GET /api/api-version/sites/site-id/users
 * Returns a list of users on the site.
 * Tableau Cloud scope: tableau:users:read
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_users_on_site
 */
const listUsersEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/users',
  alias: 'listUsers',
  description: 'Returns a list of users on the site.',
  parameters: [
    pathParam('siteId', 'segment'),
    {
      name: 'pageSize',
      type: 'Query',
      schema: z.number().optional(),
    },
    {
      name: 'pageNumber',
      type: 'Query',
      schema: z.number().optional(),
    },
    {
      name: 'includeSSOInfo',
      type: 'Query',
      schema: z.boolean().optional(),
    },
    {
      // Comma-separated list of user attributes to return, e.g.
      // `id,name,fullName,siteRole,email,lastLogin`. Callers should name every
      // field explicitly rather than relying on Tableau's default set, which on
      // some sites silently omits lastLogin. Also accepts the special value
      // `_all_`, though that pulls the more expensive SSO/authSetting path.
      // @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_fields.htm
      name: 'fields',
      type: 'Query',
      schema: z.string().optional(),
    },
    {
      name: 'includeUserCount',
      type: 'Query',
      schema: z.boolean().optional(),
    },
    {
      name: 'includeGroups',
      type: 'Query',
      schema: z.boolean().optional(),
    },
  ],
  response: listUsersBodySchema,
});

/**
 * Get User on Site
 * GET /api/api-version/sites/site-id/users/user-id
 * Returns information about the specified user.
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site
 */
const getUserOnSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/users/:userId',
  alias: 'getUserOnSite',
  description: 'Returns information about the specified user',
  parameters: [pathParam('siteId', 'segment'), pathParam('userId')],
  response: z.object({ user: userSchema }),
});

/**
 * Update User
 * PUT /api/api-version/sites/site-id/users/user-id
 * Modifies information about the specified user (site role, auth setting, etc.).
 * Tableau Cloud scope: tableau:users:update
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user
 */
const updateUserEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/users/:userId',
  alias: 'updateUser',
  description: 'Modifies information about the specified user',
  parameters: [
    pathParam('siteId', 'segment'),
    pathParam('userId'),
    { name: 'body', type: 'Body', schema: z.object({ user: z.object({ siteRole: z.string() }) }) },
  ],
  response: z.object({ user: userSchema.partial() }),
});

const listGroupsBodySchema = z.object({
  pagination: paginationSchema.optional(),
  groups: z.union([
    z.object({
      group: z.union([z.array(groupSchema), groupSchema.transform((g) => [g])]),
    }),
    z.array(groupSchema).transform((groups) => ({ group: groups })),
    z.object({}).transform(() => ({ group: [] })),
  ]),
});

const listGroupsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/groups',
  alias: 'listGroups',
  description: 'Returns a list of groups on the site.',
  parameters: [
    pathParam('siteId', 'segment'),
    { name: 'pageSize', type: 'Query', schema: z.number().optional() },
    { name: 'pageNumber', type: 'Query', schema: z.number().optional() },
    { name: 'filter', type: 'Query', schema: z.string().optional() },
    { name: 'sort', type: 'Query', schema: z.string().optional() },
  ],
  response: listGroupsBodySchema,
});

const usersApi = makeApi([
  listUsersEndpoint,
  getUserOnSiteEndpoint,
  updateUserEndpoint,
  listGroupsEndpoint,
]);
export const usersApis = [...usersApi] as const satisfies ZodiosEndpointDefinitions;
