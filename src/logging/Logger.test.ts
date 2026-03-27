import { describe, expect, it } from 'vitest';

import { LoggerType, parseLoggerTypes } from './Logger.js';

describe('parseLoggerTypes', () => {
  it('should return appLogger by default when value is undefined', () => {
    expect(parseLoggerTypes(undefined)).toEqual(new Set([LoggerType.AppLogger]));
  });

  it('should return appLogger by default when value is empty string', () => {
    expect(parseLoggerTypes('')).toEqual(new Set([LoggerType.AppLogger]));
  });

  it('should parse logger types', () => {
    expect(parseLoggerTypes('fileLogger,appLogger')).toEqual(
      new Set([LoggerType.FileLogger, LoggerType.AppLogger]),
    );
  });

  it('should trim whitespace around values', () => {
    expect(parseLoggerTypes(' fileLogger , appLogger ')).toEqual(
      new Set([LoggerType.FileLogger, LoggerType.AppLogger]),
    );
  });

  it('should filter out unknown values', () => {
    expect(parseLoggerTypes('fileLogger,unknown,appLogger')).toEqual(
      new Set([LoggerType.FileLogger, LoggerType.AppLogger]),
    );
  });

  it('should return empty set when all values are unknown', () => {
    expect(parseLoggerTypes('unknown,other')).toEqual(new Set());
  });
});
