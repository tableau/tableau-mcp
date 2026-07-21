import { describe, expect, it } from 'vitest';

import type { SchemaField } from './schema-summary.js';
import { inferStringTemporal } from './stringTemporal.js';

function field(over: Partial<SchemaField>): SchemaField {
  return {
    name: 'x',
    columnName: '[x]',
    role: 'dimension',
    type: 'nominal',
    datatype: 'string',
    datasource: 'ds',
    isAggregated: false,
    column_ref: '[ds].[x]',
    ...over,
  };
}

describe('inferStringTemporal', () => {
  it('accepts a string "month" dimension → yyyy-MM (month granularity)', () => {
    expect(inferStringTemporal(field({ name: 'month' }))?.format).toBe('yyyy-MM');
    expect(inferStringTemporal(field({ name: 'Year Month' }))?.format).toBe('yyyy-MM');
    expect(inferStringTemporal(field({ name: 'ym' }))?.format).toBe('yyyy-MM');
  });

  it('accepts a string "date"/"day" dimension → yyyy-MM-dd (full date)', () => {
    expect(inferStringTemporal(field({ name: 'order date' }))?.format).toBe('yyyy-MM-dd');
    expect(inferStringTemporal(field({ name: 'day' }))?.format).toBe('yyyy-MM-dd');
  });

  it('REJECTS a real date/datetime field (it never needs parsing)', () => {
    expect(inferStringTemporal(field({ name: 'month', datatype: 'date' }))).toBeNull();
    expect(inferStringTemporal(field({ name: 'order date', datatype: 'datetime' }))).toBeNull();
  });

  it('REJECTS a string whose name is NOT date-like (fail-closed — no silent NULL axis)', () => {
    expect(inferStringTemporal(field({ name: 'product' }))).toBeNull();
    expect(inferStringTemporal(field({ name: 'region' }))).toBeNull();
    expect(inferStringTemporal(field({ name: 'customer segment' }))).toBeNull();
  });

  it('REJECTS a measure (temporal axes are dimensions)', () => {
    expect(inferStringTemporal(field({ name: 'month', role: 'measure' }))).toBeNull();
  });

  it('does not match a date token buried inside an unrelated word (word-boundary guard)', () => {
    // "payday" / "gateway" embed day/... as substrings, not words → must NOT match.
    expect(inferStringTemporal(field({ name: 'payday note' }))).toBeNull();
    expect(inferStringTemporal(field({ name: 'gateway' }))).toBeNull();
    // but a real "day of week" dimension IS date-like
    expect(inferStringTemporal(field({ name: 'day of week' }))?.format).toBe('yyyy-MM-dd');
  });
});
