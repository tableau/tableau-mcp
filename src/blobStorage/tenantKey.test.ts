import { McpToolError } from '../errors/mcpToolError.js';
import invariant from '../utils/invariant.js';
import { buildTenantBlobKey, getTenantLuids } from './tenantKey.js';

const MOCK_SITE_LUID = '0a1b2c3d-1111-4222-8333-444455556666';
const MOCK_USER_LUID = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';

describe('buildTenantBlobKey', () => {
  it('places the site and user LUIDs before the logical key', () => {
    expect(
      buildTenantBlobKey({ siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID }, 'images/v/x.png'),
    ).toBe(`${MOCK_SITE_LUID}/${MOCK_USER_LUID}/images/v/x.png`);
  });

  it.each([
    ['empty site', '', MOCK_USER_LUID],
    ['empty user', MOCK_SITE_LUID, ''],
    ['path traversal', '../other-site', MOCK_USER_LUID],
    ['non-uuid', MOCK_SITE_LUID, 'test-user-luid'],
  ])('rejects an invalid tenant (%s)', (_, siteLuid, userLuid) => {
    expect(() => buildTenantBlobKey({ siteLuid, userLuid }, 'images/v/x.png')).toThrow(
      'Invalid tenant LUIDs for blob storage key.',
    );
  });
});

describe('getTenantLuids', () => {
  it('returns the session site and user LUIDs', () => {
    const result = getTenantLuids({
      getSiteLuid: () => MOCK_SITE_LUID,
      getUserLuid: () => MOCK_USER_LUID,
    });
    invariant(result.isOk());
    expect(result.value).toEqual({ siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID });
  });

  it.each([
    ['empty site', '', MOCK_USER_LUID],
    ['empty user', MOCK_SITE_LUID, ''],
    ['path traversal', MOCK_SITE_LUID, `../${MOCK_USER_LUID}`],
  ])('returns an McpToolError for an invalid identity (%s)', (_, siteLuid, userLuid) => {
    const result = getTenantLuids({ getSiteLuid: () => siteLuid, getUserLuid: () => userLuid });
    invariant(result.isErr());
    expect(result.error).toBeInstanceOf(McpToolError);
  });
});
