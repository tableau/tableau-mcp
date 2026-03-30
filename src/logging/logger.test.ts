import { describe, expect, it } from 'vitest';

import { parseLoggerTypes } from './logger.js';

describe('parseLoggerTypes', () => {
  it('should return appLogger by default when value is undefined', () => {
    expect(parseLoggerTypes(undefined)).toEqual(new Set(['appLogger']));
  });

  it('should return appLogger by default when value is empty string', () => {
    expect(parseLoggerTypes('')).toEqual(new Set(['appLogger']));
  });

  it('should parse appLogger', () => {
    expect(parseLoggerTypes('appLogger')).toEqual(new Set(['appLogger']));
  });

  it('should parse fileLogger', () => {
    expect(parseLoggerTypes('fileLogger')).toEqual(new Set(['fileLogger']));
  });

  it('should parse both loggers', () => {
    expect(parseLoggerTypes('fileLogger,appLogger')).toEqual(new Set(['fileLogger', 'appLogger']));
  });

  it('should trim whitespace around values', () => {
    expect(parseLoggerTypes(' fileLogger , appLogger ')).toEqual(
      new Set(['fileLogger', 'appLogger']),
    );
  });

  it('should filter out unknown values', () => {
    expect(parseLoggerTypes('fileLogger,unknown,appLogger')).toEqual(
      new Set(['fileLogger', 'appLogger']),
    );
  });

  it('should return empty set when all values are unknown', () => {
    expect(parseLoggerTypes('unknown,other')).toEqual(new Set());
  });
});
