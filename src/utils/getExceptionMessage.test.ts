import { getExceptionMessage } from './getExceptionMessage.js';

describe('getExceptionMessage', () => {
  it('should return error message for Error objects', () => {
    const error = new Error('Test error message');
    expect(getExceptionMessage(error)).toBe('Test error message');
  });

  it('should return stringified JSON for serializable objects', () => {
    const obj = { key: 'value', number: 123 };
    expect(getExceptionMessage(obj)).toBe('{"key":"value","number":123}');
  });

  it('should return string representation for non-serializable objects', () => {
    const circular: any = {};
    circular.self = circular;

    expect(getExceptionMessage(circular)).toBe('[object Object]');
  });

  it('should handle primitive values', () => {
    expect(getExceptionMessage('string')).toBe('"string"');
    expect(getExceptionMessage(123)).toBe('123');
    expect(getExceptionMessage(true)).toBe('true');
    expect(getExceptionMessage(null)).toBe('null');
    expect(getExceptionMessage(undefined)).toBe('undefined');
  });
});
