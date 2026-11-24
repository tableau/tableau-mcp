import { apiVersionAtLeast } from './apiVersion.js';

describe('apiVersionAtLeast', () => {
  it.each([
    ['0.2.6', '0.2.6', true],
    ['0.2.6', '0.2.5', true],
    ['0.2.5', '0.2.6', false],
    ['0.3.0', '0.2.9', true],
    ['1.0.0', '0.9.9', true],
    ['0.9.9', '1.0.0', false],
    ['0.2.10', '0.2.9', true],
    ['0.1.1', '0.1.1', true],
    ['0.1.0', '0.1.1', false],
  ])('%s >= %s → %s', (current, minimum, expected) => {
    expect(apiVersionAtLeast(current, minimum)).toBe(expected);
  });

  it('treats a shorter version as zero-padded (0.2 === 0.2.0)', () => {
    expect(apiVersionAtLeast('0.2', '0.2.0')).toBe(true);
    expect(apiVersionAtLeast('0.2', '0.2.1')).toBe(false);
  });

  it('parses undefined and empty as 0.0.0 — below every real floor', () => {
    expect(apiVersionAtLeast(undefined, '0.2.5')).toBe(false);
    expect(apiVersionAtLeast('', '0.2.5')).toBe(false);
    expect(apiVersionAtLeast(undefined, '0.0.0')).toBe(true);
  });

  it('reads unparseable parts as zero rather than throwing', () => {
    expect(apiVersionAtLeast('0.x.y', '0.0.0')).toBe(true);
    expect(apiVersionAtLeast('0.x.y', '0.1.0')).toBe(false);
  });
});
