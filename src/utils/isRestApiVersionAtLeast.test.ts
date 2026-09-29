import { describe, expect, it } from 'vitest';

import {
  isRestApiVersionAtLeast,
  MIN_REST_API_VERSION_FOR_EMBEDDED_QUERY,
} from './isRestApiVersionAtLeast.js';

describe('isRestApiVersionAtLeast', () => {
  const min = MIN_REST_API_VERSION_FOR_EMBEDDED_QUERY; // '3.30'

  it('returns false when the current minor is below the minimum', () => {
    expect(isRestApiVersionAtLeast('3.29', min)).toBe(false);
  });

  it('returns true when the current version equals the minimum', () => {
    expect(isRestApiVersionAtLeast('3.30', min)).toBe(true);
  });

  it('returns true when the current minor is above the minimum', () => {
    expect(isRestApiVersionAtLeast('3.31', min)).toBe(true);
  });

  it('returns true when the current major is above the minimum', () => {
    expect(isRestApiVersionAtLeast('4.0', min)).toBe(true);
  });

  it('returns false when the current major is below the minimum', () => {
    expect(isRestApiVersionAtLeast('2.99', min)).toBe(false);
  });

  it.each(['', 'abc', '3'])(
    'assumes capable (returns true) for the malformed version %j',
    (current) => {
      expect(isRestApiVersionAtLeast(current, min)).toBe(true);
    },
  );
});
