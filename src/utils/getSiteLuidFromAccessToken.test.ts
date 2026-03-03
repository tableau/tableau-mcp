import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';

describe('getSiteLuidFromAccessToken', () => {
  it('should extract site LUID from valid access token', () => {
    const accessToken = 'part0|part1|site-luid-123';
    expect(getSiteLuidFromAccessToken(accessToken)).toBe('site-luid-123');
  });

  it('should return empty string when accessToken is undefined', () => {
    expect(getSiteLuidFromAccessToken(undefined)).toBe('');
  });

  it('should return empty string when accessToken is empty string', () => {
    expect(getSiteLuidFromAccessToken('')).toBe('');
  });

  it('should return empty string when token has less than 3 parts', () => {
    expect(getSiteLuidFromAccessToken('part0')).toBe('');
    expect(getSiteLuidFromAccessToken('part0|part1')).toBe('');
  });

  it('should handle token with no pipe delimiters', () => {
    expect(getSiteLuidFromAccessToken('notoken')).toBe('');
  });

  it('should extract empty site LUID if third part is empty', () => {
    const accessToken = 'part0|part1||';
    expect(getSiteLuidFromAccessToken(accessToken)).toBe('');
  });
});
