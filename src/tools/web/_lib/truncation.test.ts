import { getProbeRowLimit } from './truncation.js';

describe('getProbeRowLimit', () => {
  it('requests one extra row', () => {
    expect(getProbeRowLimit(100)).toBe(101);
  });

  it('does not exceed a 32-bit int', () => {
    expect(getProbeRowLimit(2147483647)).toBe(2147483647);
    expect(getProbeRowLimit(Number.MAX_SAFE_INTEGER)).toBe(2147483647);
  });
});
