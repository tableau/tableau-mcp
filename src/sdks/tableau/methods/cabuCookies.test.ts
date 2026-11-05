import { describe, expect, it } from 'vitest';

import { extractSetCookies, toCookieHeader } from './cabuCookies.js';

describe('extractSetCookies', () => {
  it('returns an empty array when there is no set-cookie header', () => {
    expect(extractSetCookies({})).toEqual([]);
  });

  it('wraps a single set-cookie string in an array', () => {
    expect(extractSetCookies({ 'set-cookie': 'cabuCtx=abc123; Path=/; HttpOnly' })).toEqual([
      'cabuCtx=abc123; Path=/; HttpOnly',
    ]);
  });

  it('passes through multiple set-cookie values for sliced cabuCtx cookies', () => {
    const headers = {
      'set-cookie': [
        'cabuCtx.0=part0; Path=/; HttpOnly',
        'cabuCtx.1=part1; Path=/; HttpOnly',
      ],
    };

    expect(extractSetCookies(headers)).toEqual([
      'cabuCtx.0=part0; Path=/; HttpOnly',
      'cabuCtx.1=part1; Path=/; HttpOnly',
    ]);
  });
});

describe('toCookieHeader', () => {
  it('returns undefined for an empty cookie list', () => {
    expect(toCookieHeader([])).toBeUndefined();
  });

  it('strips cookie attributes, keeping only name=value', () => {
    expect(toCookieHeader(['cabuCtx=abc123; Path=/; HttpOnly'])).toBe('cabuCtx=abc123');
  });

  it('joins multiple cookies with "; "', () => {
    expect(
      toCookieHeader(['cabuCtx.0=part0; Path=/; HttpOnly', 'cabuCtx.1=part1; Path=/; HttpOnly']),
    ).toBe('cabuCtx.0=part0; cabuCtx.1=part1');
  });
});
