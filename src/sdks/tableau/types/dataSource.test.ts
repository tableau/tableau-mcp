import { describe, expect, it } from 'vitest';

import { dataSourceSchema } from './dataSource.js';

// The Query Data Sources REST endpoint can deliver `isCertified` as the STRINGS "true"/"false"
// rather than JSON booleans. These tests feed raw strings through the real schema to guard the
// `tableauBoolean` preprocess against a regression to `z.coerce.boolean()`, which maps
// "false" -> true (the `Boolean("false") === true` footgun) and would mis-credit an uncertified
// clone as certified (W-24106279).
describe('dataSourceSchema — isCertified (tableauBoolean)', () => {
  const base = {
    id: 'ds-1',
    name: 'Sales',
    project: { id: 'proj-1', name: 'Default' },
    tags: {},
  };

  const parseIsCertified = (isCertified: unknown): unknown => {
    const result = dataSourceSchema.safeParse({ ...base, isCertified });
    expect(result.success).toBe(true);
    return result.data?.isCertified;
  };

  it('coerces the string "false" to false (the critical regression guard)', () => {
    expect(parseIsCertified('false')).toBe(false);
  });

  it('coerces the string "true" to true', () => {
    expect(parseIsCertified('true')).toBe(true);
  });

  it('coerces mixed-case "True" to true (case-insensitive)', () => {
    expect(parseIsCertified('True')).toBe(true);
  });

  it('coerces the empty string to false', () => {
    expect(parseIsCertified('')).toBe(false);
  });

  it('passes JS booleans through unchanged', () => {
    expect(parseIsCertified(true)).toBe(true);
    expect(parseIsCertified(false)).toBe(false);
  });

  it('leaves isCertified undefined when omitted', () => {
    const result = dataSourceSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.isCertified).toBeUndefined();
  });
});
