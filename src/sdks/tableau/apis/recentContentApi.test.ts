import { RouteSafetyError } from '../../routeSafety/core.js';
import { recentContentApis } from './recentContentApi.js';

describe('recent content REST endpoint', () => {
  const endpoint = recentContentApis[0];

  it('declares only the read-only versioned site route and site path parameter', () => {
    expect(endpoint).toMatchObject({
      method: 'get',
      alias: 'getRecentlyViewedForSite',
      path: '/sites/:siteId/content/recent',
    });
    expect(endpoint.parameters).toHaveLength(1);
    expect(endpoint.parameters[0]).toMatchObject({ name: 'siteId', type: 'Path' });
  });

  it('rejects unsafe site IDs', () => {
    expect(() => endpoint.parameters[0].schema.parse('../another-site')).toThrow(RouteSafetyError);
  });

  it('accepts the explicit empty-response fixture contract', () => {
    expect(endpoint.response.parse({ recents: {} })).toEqual({ recents: {} });
  });
});
