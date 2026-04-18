import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getFileLogger } from './fileLogger.js';
import { log, parseLoggerTypes, parseLogLevel, shouldLog } from './logger.js';

vi.mock('./fileLogger.js', () => ({
  getFileLogger: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('log', () => {
  const entry = { message: 'test message', level: 'info' as const, logger: 'test' };

  it('should write JSON to stderr when transport is stdio and appLogger is enabled', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log(entry);

    expect(stderrSpy).toHaveBeenCalledWith(JSON.stringify(entry) + '\n');
    stderrSpy.mockRestore();
  });

  it('should write JSON to console.log when transport is http and appLogger is enabled', () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log(entry);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(entry));
    consoleSpy.mockRestore();
  });

  it('should not write to stderr or console when appLogger is not enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'fileLogger');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log(entry);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('should route to file logger when fileLogger is enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'fileLogger');
    const mockLog = vi.fn();
    vi.mocked(getFileLogger).mockReturnValue({ log: mockLog } as any);

    log(entry);

    expect(getFileLogger).toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(entry);
  });

  it('should not route to file logger when fileLogger is not enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'appLogger');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log(entry);

    expect(getFileLogger).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('should not log when entry level is below configured log level', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'debug message', level: 'debug', logger: 'test' });
    log({ message: 'info message', level: 'info', logger: 'test' });

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('should log when entry level meets configured log level', () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'info message', level: 'info', logger: 'test' });
    log({ message: 'error message', level: 'error', logger: 'test' });

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    stderrSpy.mockRestore();
  });
});

describe('parseLogLevel', () => {
  it('should return info by default when value is undefined', () => {
    expect(parseLogLevel(undefined)).toBe('info');
  });

  it('should return info for invalid values', () => {
    expect(parseLogLevel('invalid')).toBe('info');
    expect(parseLogLevel('')).toBe('info');
  });

  it('should parse valid log levels', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('info')).toBe('info');
    expect(parseLogLevel('error')).toBe('error');
  });

  it('should return info for unsupported values', () => {
    expect(parseLogLevel('warning')).toBe('info');
    expect(parseLogLevel('emergency')).toBe('info');
  });

  it('should trim whitespace', () => {
    expect(parseLogLevel(' error ')).toBe('error');
  });
});

describe('shouldLog', () => {
  it('should return true when entry level equals min level', () => {
    expect(shouldLog('error', 'error')).toBe(true);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('debug', 'debug')).toBe(true);
  });

  it('should return true when entry level is above min level', () => {
    expect(shouldLog('error', 'info')).toBe(true);
    expect(shouldLog('error', 'debug')).toBe(true);
    expect(shouldLog('info', 'debug')).toBe(true);
  });

  it('should return false when entry level is below min level', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('debug', 'error')).toBe(false);
    expect(shouldLog('info', 'error')).toBe(false);
  });

  it('should log everything at debug level', () => {
    expect(shouldLog('debug', 'debug')).toBe(true);
    expect(shouldLog('info', 'debug')).toBe(true);
    expect(shouldLog('error', 'debug')).toBe(true);
  });
});
