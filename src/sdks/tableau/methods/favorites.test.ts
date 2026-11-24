import { expect, it } from 'vitest';

import { usersApis } from '../apis/usersApi.js';

it('decodes the paginated favorites response without personal labels', () => {
  const endpoint = usersApis.find((api) => api.alias === 'listFavoritesForUser');
  expect(endpoint?.method).toBe('get');
  expect(endpoint?.path).toBe('/sites/:siteId/favorites/:userId');
  expect(
    endpoint?.response.parse({
      favorites: { favorite: [{ label: 'Personal', view: { id: 'v1' } }] },
      pagination: { pageNumber: '2', pageSize: '1', totalAvailable: '3' },
    }),
  ).toEqual({
    favorites: { favorite: [{ view: { id: 'v1' } }] },
    pagination: { pageNumber: 2, pageSize: 1, totalAvailable: 3 },
  });
});
