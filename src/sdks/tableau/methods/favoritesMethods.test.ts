import { AxiosError } from 'axios';

import { RouteSafetyError } from '../../routeSafety/core.js';
import { FavoriteResourceType } from '../types/favorite.js';
import FavoritesMethods from './favoritesMethods.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceId = '11111111-1111-4111-8111-111111111111';
const siteId = 'site-from-session';
const responseHeaderCases: Record<string, string>[] = [
  { 'content-type': 'application/json' },
  {},
  { 'content-type': 'text/html' },
];

function makeMethods(
  data: unknown,
  status = 200,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): { methods: FavoritesMethods; adapter: ReturnType<typeof vi.fn> } {
  const adapter = vi.fn(async (config) => ({
    data,
    status,
    statusText: 'OK',
    headers,
    config,
  }));
  const methods = new FavoritesMethods(
    'https://tableau.test/api/3.29',
    { type: 'Bearer', token: 'fixture' },
    { adapter },
  );
  return { methods, adapter };
}

describe('FavoritesMethods', () => {
  it('accepts the Cloud position and addedAt envelope without exposing either value', async () => {
    const { methods } = makeMethods({
      favorites: {
        favorite: [
          {
            label: 'Sales',
            position: '17',
            addedAt: '2026-10-29T00:00:00Z',
            workbook: { id: resourceId },
          },
        ],
      },
    });
    const result = await methods.queryFavorites({ siteId, userId });
    expect(result.favorites).toEqual([{ resourceType: 'workbook', resourceId, label: 'Sales' }]);
    expect(JSON.stringify(result)).not.toContain('2026-10-29');
    expect(result.favorites[0]).not.toHaveProperty('position');
    expect(result.favorites[0]).not.toHaveProperty('addedAt');
  });

  it.each([null, 17, true, { private: 'PRIVATE_VALUE' }, ['PRIVATE_VALUE']])(
    'rejects nonstring addedAt metadata %j',
    async (addedAt) => {
      const { methods } = makeMethods({
        favorites: { favorite: [{ addedAt, workbook: { id: resourceId } }] },
      });
      const result = await methods.queryFavorites({ siteId, userId });
      expect(result.favorites).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
    },
  );

  it.each(['0', '17', 0, 17])('accepts position %j without returning it', async (position) => {
    const { methods } = makeMethods({
      favorites: { favorite: [{ label: 'Sales', position, workbook: { id: resourceId } }] },
    });
    const result = await methods.queryFavorites({ siteId, userId });
    expect(result.favorites).toEqual([{ resourceType: 'workbook', resourceId, label: 'Sales' }]);
    expect(result.favorites[0]).not.toHaveProperty('position');
  });

  it('keeps unknown, ambiguous and structured position envelopes excluded', async () => {
    const { methods } = makeMethods({
      favorites: {
        favorite: [
          { position: '0', workbook: { id: resourceId }, future: { id: resourceId } },
          { position: '1', workbook: { id: resourceId }, view: { id: resourceId } },
          { position: { private: 'PRIVATE_VALUE' }, workbook: { id: resourceId } },
        ],
      },
    });
    const result = await methods.queryFavorites({ siteId, userId });
    expect(result.favorites).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
  });

  it('accepts documented favorite metadata without returning project or owner names', async () => {
    const { methods } = makeMethods({
      favorites: {
        favorite: [
          {
            label: 'Sales',
            parentProjectName: 'PRIVATE_PROJECT',
            targetOwnerName: 'PRIVATE_OWNER',
            workbook: { id: resourceId },
          },
        ],
      },
    });
    const result = await methods.queryFavorites({ siteId, userId });
    expect(result.favorites).toEqual([{ resourceType: 'workbook', resourceId, label: 'Sales' }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('gets one page with exact query names, authentication, and normalized output', async () => {
    const { methods, adapter } = makeMethods({
      pagination: { pageNumber: '2', pageSize: '1000', totalAvailable: '1500' },
      favorites: {
        favorite: [
          {
            label: 'Sales',
            view: { id: resourceId, name: 'Overview', owner: { id: 'private-owner' }, tags: {} },
          },
        ],
      },
    });
    expect(await methods.queryFavorites({ siteId, userId, pageSize: 1000, pageNumber: 2 })).toEqual(
      {
        favorites: [{ resourceType: 'view', resourceId, label: 'Sales' }],
        rawCount: 1,
        pagination: { pageNumber: 2, pageSize: 1000, totalAvailable: 1500 },
      },
    );
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        url: `/sites/${siteId}/favorites/${userId}`,
        params: { pageSize: 1000, pageNumber: 2 },
      }),
    );
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer fixture');
  });

  it('tolerates empty, deleted, unknown, legacy, malformed and ambiguous favorite types without exposing them', async () => {
    const { methods } = makeMethods({
      favorites: {
        favorite: [
          { label: 'Deleted' },
          { label: 'Collection secret', collection: { id: resourceId } },
          { label: 'Legacy secret', metric: { id: resourceId } },
          { label: 'Future secret', future: { id: resourceId } },
          { label: 'Malformed', workbook: { id: '../unsafe' } },
          { label: 'Ambiguous', workbook: { id: resourceId }, collection: { id: resourceId } },
          { label: 'Supported', datasource: { id: resourceId } },
        ],
      },
    });
    const result = await methods.queryFavorites({ siteId, userId });
    expect(result.favorites).toEqual([
      { resourceType: 'datasource', resourceId, label: 'Supported' },
    ]);
    expect(result.pagination).toBeUndefined();
    const empty = makeMethods({ favorites: {} });
    expect((await empty.methods.queryFavorites({ siteId, userId })).favorites).toEqual([]);
  });

  it.each(['workbook', 'view', 'datasource', 'project', 'flow'] as FavoriteResourceType[])(
    'adds %s using the exact JSON body and never returns the response shortlist',
    async (resourceType) => {
      const { methods, adapter } = makeMethods({
        favorites: { favorite: [{ label: 'Unrelated secret', collection: { id: resourceId } }] },
      });
      await expect(
        methods.addFavorite({ siteId, userId, resourceType, resourceId, label: '売上 & <Sales>' }),
      ).resolves.toBeUndefined();
      const config = adapter.mock.calls[0][0];
      expect(config.method).toBe('put');
      expect(config.url).toBe(`/sites/${siteId}/favorites/${userId}`);
      expect(JSON.parse(config.data)).toEqual({
        favorite: { label: '売上 & <Sales>', [resourceType]: { id: resourceId } },
      });
      expect(config.headers['Content-Type']).toBe('application/json');
    },
  );

  it.each(['workbook', 'view', 'datasource', 'project', 'flow'] as FavoriteResourceType[])(
    'removes only %s membership with the official plural route and an empty 204 response',
    async (resourceType) => {
      const { methods, adapter } = makeMethods('', 204);
      await expect(
        methods.removeFavorite({ siteId, userId, resourceType, resourceId }),
      ).resolves.toBeUndefined();
      expect(adapter).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'delete',
          url: `/sites/${siteId}/favorites/${userId}/${resourceType}s/${resourceId}`,
        }),
      );
      expect(adapter.mock.calls[0][0].data).toBeUndefined();
    },
  );

  it.each(['', '   ', '\n\t'])(
    'rejects blank favorite label %j before a request',
    async (label) => {
      const { methods, adapter } = makeMethods({ favorites: {} });
      await expect(
        methods.addFavorite({ siteId, userId, resourceType: 'workbook', resourceId, label }),
      ).rejects.toThrow();
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it.each(['../other', '%2e%2e', 'x/y', 'not-a-luid'])(
    'blocks unsafe user %j in list/add/remove before transport',
    async (unsafe) => {
      const { methods, adapter } = makeMethods({ favorites: {} });
      await expect(methods.queryFavorites({ siteId, userId: unsafe })).rejects.toBeInstanceOf(
        RouteSafetyError,
      );
      await expect(
        methods.addFavorite({
          siteId,
          userId: unsafe,
          resourceType: 'view',
          resourceId,
          label: 'Valid',
        }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      await expect(
        methods.removeFavorite({ siteId, userId: unsafe, resourceType: 'view', resourceId }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it('uses existing X-Tableau-Auth credentials for PAT/session transport without any OAuth grants', async () => {
    const adapter = vi.fn(async (config) => ({
      data: { favorites: {} },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));
    const methods = new FavoritesMethods(
      'https://tableau.test/api/3.24',
      {
        type: 'X-Tableau-Auth',
        token: 'fixture-session',
        user: { id: userId },
        site: { id: siteId },
      },
      { adapter },
    );
    await methods.addFavorite({
      siteId,
      userId,
      resourceType: 'workbook',
      resourceId,
      label: 'Sales',
    });
    expect(adapter.mock.calls[0][0].headers['X-Tableau-Auth']).toBe('fixture-session');
    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });

  it.each(responseHeaderCases)(
    'sanitizes malformed GET/PUT responses with media type %j without retaining raw favorites',
    async (headers) => {
      const sentinel = 'PRIVATE_UNBOUNDED_LABEL_SENTINEL';
      const { methods } = makeMethods({ favorites: { favorite: sentinel } }, 200, headers);
      await expect(methods.queryFavorites({ siteId, userId })).rejects.toThrow(
        'invalid favorites response',
      );
      const readError = await methods
        .queryFavorites({ siteId, userId })
        .catch((error: unknown) => error);
      expect(String(readError)).not.toContain(sentinel);
      expect(readError).not.toHaveProperty('cause');
      const putError = await methods
        .addFavorite({ siteId, userId, resourceType: 'workbook', resourceId, label: 'Sales' })
        .catch((error: unknown) => error);
      expect(String(putError)).toContain('favorite may have changed');
      expect(String(putError)).not.toContain(sentinel);
      expect(putError).not.toHaveProperty('cause');
    },
  );

  it('preserves non-schema HTTP errors rather than hiding their status or treating them as a successful mutation', async () => {
    const error = new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST');
    Object.assign(error, { response: { status: 403, data: { error: { code: '403004' } } } });
    const { methods, adapter } = makeMethods({ favorites: {} });
    adapter.mockRejectedValue(error);
    await expect(methods.queryFavorites({ siteId, userId })).rejects.toBe(error);
    await expect(
      methods.addFavorite({ siteId, userId, resourceType: 'workbook', resourceId, label: 'Sales' }),
    ).rejects.toBe(error);
  });

  it('rejects a response that lacks the official favorites envelope', async () => {
    const { methods } = makeMethods({ favorite: [] });
    await expect(methods.queryFavorites({ siteId, userId })).rejects.toThrow();
  });
});
