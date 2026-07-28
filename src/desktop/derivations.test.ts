import { describe, expect, it } from 'vitest';

import {
  CANONICAL_DERIVATIONS,
  DERIVATION_LONG_TO_SHORT,
  DERIVATION_SHORT_TO_LONG,
  resolveDerivation,
  tryResolveDerivation,
  UnknownDerivationError,
} from './derivations.js';

describe('derivations — one table, and every entry lands inside the validator', () => {
  // This is the class-closing invariant. `attr: 'Attr'` shipped in two separate maps
  // for months because nothing tied a writer's output to the preflight that judges
  // it. Any future entry that Tableau would silently rewrite to None fails here.
  it.each(Object.entries(DERIVATION_SHORT_TO_LONG))(
    'short form %s resolves to canonical derivation %s',
    (_short, long) => {
      expect(CANONICAL_DERIVATIONS.has(long)).toBe(true);
    },
  );

  it.each(Object.entries(DERIVATION_LONG_TO_SHORT))(
    'canonical derivation %s round-trips through its short form %s',
    (long, short) => {
      expect(resolveDerivation(short)).toBe(long);
    },
  );

  it('covers every canonical derivation with exactly one emit prefix', () => {
    expect(new Set(Object.keys(DERIVATION_LONG_TO_SHORT))).toEqual(new Set(CANONICAL_DERIVATIONS));
    const shorts = Object.values(DERIVATION_LONG_TO_SHORT);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it('maps attr to Attribute — never the look-alike Attr', () => {
    expect(resolveDerivation('attr')).toBe('Attribute');
    expect(CANONICAL_DERIVATIONS.has('Attr')).toBe(false);
  });

  it('resolves the prefixes the old maps dropped', () => {
    expect(resolveDerivation('cnt')).toBe('Count');
    expect(resolveDerivation('ctd')).toBe('CountD');
    expect(resolveDerivation('med')).toBe('Median');
    expect(resolveDerivation('std')).toBe('Stdev');
    expect(resolveDerivation('stp')).toBe('StdevP');
    expect(resolveDerivation('vrp')).toBe('VarP');
    expect(resolveDerivation('wd')).toBe('Weekday');
    expect(resolveDerivation('my')).toBe('MY');
    expect(resolveDerivation('md')).toBe('MDY');
    expect(resolveDerivation('iqr')).toBe('ISO-Qtr');
  });

  it('strips table-calc wrappers to the base aggregation', () => {
    expect(resolveDerivation('cum:sum')).toBe('Sum');
    expect(resolveDerivation('pcto:cum:sum')).toBe('Sum');
    expect(resolveDerivation('rank:ctd')).toBe('CountD');
  });

  it('throws on an unknown prefix instead of echoing it onward', () => {
    expect(() => resolveDerivation('countdistinct-ish')).toThrow(UnknownDerivationError);
    expect(() => resolveDerivation('')).toThrow(UnknownDerivationError);
  });

  it('names the real cause and the usable prefixes in the throw', () => {
    let message = '';
    try {
      resolveDerivation('cuont');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"cuont"');
    expect(message).toContain('rewrite the pill to None');
    expect(message).toContain('cnt=Count');
  });

  it('offers a non-throwing read path for whatever a workbook happens to hold', () => {
    expect(tryResolveDerivation('cnt')).toBe('Count');
    expect(tryResolveDerivation('nonsense')).toBeUndefined();
  });
});
