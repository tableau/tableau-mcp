import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

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
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
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
  parameters: [
    { name: 'siteId', type: 'Path', schema: z.string() },
    { name: 'userId', type: 'Path', schema: z.string() },
  ],
  response: z.object({ user: userSchema }),
});

const usersApi = makeApi([listUsersEndpoint, getUserOnSiteEndpoint]);
export const usersApis = [...usersApi] as const satisfies ZodiosEndpointDefinitions;
