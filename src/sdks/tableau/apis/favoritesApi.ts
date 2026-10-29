import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { luidSchema, pathParam } from '../../routeSafety/ids.js';
import { favoriteLabelSchema, rawFavoriteSchema } from '../types/favorite.js';
import { paginationSchema } from '../types/pagination.js';
import { paginationParameters } from './paginationParameters.js';

export const favoritesResponseSchema = z.object({
  favorites: z.object({ favorite: z.array(rawFavoriteSchema).optional() }),
});

export const favoritesPageResponseSchema = favoritesResponseSchema.extend({
  pagination: paginationSchema.optional(),
});

const queryFavoritesEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/favorites/:userId',
  alias: 'queryFavorites',
  description: 'Returns favorites for the authenticated user.',
  parameters: [pathParam('siteId', 'segment'), pathParam('userId'), ...paginationParameters],
  response: favoritesPageResponseSchema,
});

const resourceSchema = z.object({ id: luidSchema });
const favoriteBodySchema = z.union([
  z.object({ label: favoriteLabelSchema, workbook: resourceSchema }).strict(),
  z.object({ label: favoriteLabelSchema, view: resourceSchema }).strict(),
  z.object({ label: favoriteLabelSchema, datasource: resourceSchema }).strict(),
  z.object({ label: favoriteLabelSchema, project: resourceSchema }).strict(),
  z.object({ label: favoriteLabelSchema, flow: resourceSchema }).strict(),
]);

const addFavoriteEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/favorites/:userId',
  alias: 'addFavorite',
  description: 'Adds one content item to the authenticated user favorites.',
  parameters: [
    pathParam('siteId', 'segment'),
    pathParam('userId'),
    { name: 'favorite', type: 'Body', schema: z.object({ favorite: favoriteBodySchema }).strict() },
  ],
  response: favoritesResponseSchema,
});

// The Flow DELETE reference has a datasource-route copy/paste error. Tableau's official TSC
// implementation confirms /flows/{id}; never use a content-deletion endpoint here.
const removeFavoriteEndpoint = makeEndpoint({
  method: 'delete',
  path: '/sites/:siteId/favorites/:userId/:resourceType/:resourceId',
  alias: 'removeFavorite',
  description: 'Removes favorite membership only; does not delete Tableau content.',
  parameters: [
    pathParam('siteId', 'segment'),
    pathParam('userId'),
    {
      name: 'resourceType',
      type: 'Path',
      schema: z.enum(['workbooks', 'views', 'datasources', 'projects', 'flows']),
    },
    pathParam('resourceId'),
  ],
  response: z.unknown(), // HTTP 204 has no response body.
});

const favoritesApi = makeApi([queryFavoritesEndpoint, addFavoriteEndpoint, removeFavoriteEndpoint]);

export const favoritesApis = [...favoritesApi] as const satisfies ZodiosEndpointDefinitions;
