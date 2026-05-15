import { milliseconds } from './milliseconds';

describe('milliseconds', () => {
  describe('fromSeconds', () => {
    it('should convert seconds to milliseconds', () => {
      expect(milliseconds.fromSeconds(5)).toBe(5000);
    });
  });

  describe('fromMinutes', () => {
    it('should convert minutes to milliseconds', () => {
      expect(milliseconds.fromMinutes(10)).toBe(600000);
    });
  });

  describe('fromHours', () => {
    it('should convert hours to milliseconds', () => {
      expect(milliseconds.fromHours(2)).toBe(7200000);
    });
  });

  describe('fromDays', () => {
    it('should convert days to milliseconds', () => {
      expect(milliseconds.fromDays(1)).toBe(86400000);
    });
  });

  describe('fromWeeks', () => {
    it('should convert weeks to milliseconds', () => {
      expect(milliseconds.fromWeeks(1)).toBe(604800000);
    });
  });

  describe('fromMonths', () => {
    it('should convert months to milliseconds', () => {
      expect(milliseconds.fromMonths(1)).toBe(2592000000);
    });
  });

  describe('fromYears', () => {
    it('should convert years to milliseconds', () => {
      expect(milliseconds.fromYears(1)).toBe(31557600000);
    });
  });
});
