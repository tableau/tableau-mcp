import { parseNumber } from './parseNumber.js';

describe('parseNumber', () => {
  it('should return defaultValue when value is undefined', () => {
    const result = parseNumber(undefined, { defaultValue: 42 });
    expect(result).toBe(42);
  });

  it('should return defaultValue when value is empty string', () => {
    const result = parseNumber('', { defaultValue: 42 });
    expect(result).toBe(42);
  });

  it('should return defaultValue when value is whitespace', () => {
    const result = parseNumber('   ', { defaultValue: 42 });
    expect(result).toBe(42);
  });

  it('should return defaultValue when value is not a number', () => {
    const result = parseNumber('abc', { defaultValue: 42 });
    expect(result).toBe(42);
  });

  it('should return defaultValue when value is NaN', () => {
    const result = parseNumber('NaN', { defaultValue: 42 });
    expect(result).toBe(42);
  });

  it('should parse valid integer string', () => {
    const result = parseNumber('123', { defaultValue: 42 });
    expect(result).toBe(123);
  });

  it('should parse valid integer string with leading zeros', () => {
    const result = parseNumber('007', { defaultValue: 42 });
    expect(result).toBe(7);
  });

  it('should parse valid integer string with whitespace', () => {
    const result = parseNumber('  456  ', { defaultValue: 42 });
    expect(result).toBe(456);
  });

  it('should parse valid decimal string', () => {
    const result = parseNumber('123.45', { defaultValue: 42 });
    expect(result).toBe(123.45);
  });

  it('should parse valid decimal string with whitespace', () => {
    const result = parseNumber('  123.45  ', { defaultValue: 42 });
    expect(result).toBe(123.45);
  });

  it('should return defaultValue when value is below minValue', () => {
    const result = parseNumber('5', { defaultValue: 42, minValue: 10 });
    expect(result).toBe(42);
  });

  it('should return defaultValue when value is above maxValue', () => {
    const result = parseNumber('100', { defaultValue: 42, maxValue: 50 });
    expect(result).toBe(42);
  });

  it('should parse valid number when within minValue and maxValue range', () => {
    const result = parseNumber('25', { defaultValue: 42, minValue: 10, maxValue: 50 });
    expect(result).toBe(25);
  });

  it('should parse valid number when value equals minValue', () => {
    const result = parseNumber('10', { defaultValue: 42, minValue: 10, maxValue: 50 });
    expect(result).toBe(10);
  });

  it('should parse valid number when value equals maxValue', () => {
    const result = parseNumber('50', { defaultValue: 42, minValue: 10, maxValue: 50 });
    expect(result).toBe(50);
  });

  it('should use default options when no options provided', () => {
    const result = parseNumber('123');
    expect(result).toBe(123);
  });

  it('should use default defaultValue of 0 when no options provided', () => {
    const result = parseNumber('abc');
    expect(result).toBe(0);
  });

  it('should handle negative numbers with appropriate minValue', () => {
    const result = parseNumber('-5', { defaultValue: 42, minValue: -10 });
    expect(result).toBe(-5);
  });

  it('should return defaultValue for negative numbers when minValue is 0', () => {
    const result = parseNumber('-5', { defaultValue: 42, minValue: 0 });
    expect(result).toBe(42);
  });
});
