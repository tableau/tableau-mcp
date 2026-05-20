import { makeApi, makeEndpoint } from '@zodios/core';
import { z } from 'zod';

import { userSchema } from '../types/user.js';

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

const usersApi = makeApi([getUserOnSiteEndpoint]);
export const usersApis = [...usersApi] as const;
