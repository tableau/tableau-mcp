import { hasPulseInsightsDisabledErrorCode } from './pulseMethods.js';

describe('pulseMethods', () => {
  describe('hasPulseInsightsDisabledErrorCode', () => {
    it('returns true when the Pulse embeddings response body contains a GIA-disabled error code', () => {
      expect(hasPulseInsightsDisabledErrorCode('PERMISSION_DENIED: 0x62c06627')).toBe(true);
    });

    it('returns false when the value does not contain a GIA-disabled error code', () => {
      expect(hasPulseInsightsDisabledErrorCode('PERMISSION_DENIED')).toBe(false);
      expect(hasPulseInsightsDisabledErrorCode(undefined)).toBe(false);
    });
  });
});
