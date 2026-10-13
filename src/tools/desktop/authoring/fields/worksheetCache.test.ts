import { distinctCacheId } from './worksheetCache.js';

describe('distinctCacheId', () => {
  it('separates names that sanitize to the same string', () => {
    expect(distinctCacheId('Sales 2024', '1')).not.toBe(distinctCacheId('Sales-2024', '1'));
  });

  it('separates names that sanitize to nothing', () => {
    expect(distinctCacheId('売上', '1')).not.toBe(distinctCacheId('利益', '1'));
  });

  it('is stable for the same name and session, and separates sessions', () => {
    expect(distinctCacheId('Sales', '1')).toBe(distinctCacheId('Sales', '1'));
    expect(distinctCacheId('Sales', '1')).not.toBe(distinctCacheId('Sales', '2'));
  });

  it('keeps a long name within a bounded file name', () => {
    expect(distinctCacheId('x'.repeat(500), '1').length).toBeLessThan(120);
  });
});
