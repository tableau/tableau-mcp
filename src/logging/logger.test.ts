import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFileLogger } from './fileLogger.js';
import { log, parseLogLevel, shouldLog } from './logger.js';
import { parseLoggerTypes } from './loggerType.js';

vi.mock('./fileLogger.js', () => ({
  getFileLogger: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
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
  const entryWithLuids = { ...entry, site_luid: '', user_luid: '' };

  it('should write JSON to stderr when transport is stdio and appLogger is enabled', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log(entry);

    expect(stderrSpy).toHaveBeenCalledWith(JSON.stringify(entryWithLuids) + '\n');
  });

  it('should write JSON to console.log when transport is http and appLogger is enabled', () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log(entry);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(entryWithLuids));
  });

  it('should not write to stderr or console when appLogger is not enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'fileLogger');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log(entry);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should route to file logger when fileLogger is enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'fileLogger');
    const mockLog = vi.fn();
    vi.mocked(getFileLogger).mockReturnValue({ log: mockLog } as any);

    log(entry);

    expect(getFileLogger).toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(entryWithLuids);
  });

  it('should not route to file logger when fileLogger is not enabled', () => {
    vi.stubEnv('ENABLED_LOGGERS', 'appLogger');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log(entry);

    expect(getFileLogger).not.toHaveBeenCalled();
  });

  it('should not log when entry level is below configured log level', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'debug message', level: 'debug', logger: 'test' });
    log({ message: 'info message', level: 'info', logger: 'test' });

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should always emit audit records even when below the configured log level', () => {
    // Audit records are a security control: an operator must not be able to suppress them by
    // raising LOG_LEVEL. The 'audit' logger bypasses the level filter (W-23125362).
    vi.stubEnv('LOG_LEVEL', 'error');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'mutation-audit', level: 'notice', logger: 'audit', data: { foo: 'bar' } });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toContain('mutation-audit');
  });

  it('should not let a non-audit notice through when below the configured log level', () => {
    // Guard against the bypass being too broad: only logger 'audit' is exempt.
    vi.stubEnv('LOG_LEVEL', 'error');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'ordinary notice', level: 'notice', logger: 'tool' });

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should log when entry level meets configured log level', () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('TRANSPORT', 'stdio');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    log({ message: 'info message', level: 'info', logger: 'test' });
    log({ message: 'error message', level: 'error', logger: 'test' });

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('should serialize Error objects with name, message, and stack only', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Create an actual Error instance with AxiosError properties including sensitive config
    const mockAxiosError = Object.assign(new Error('Request failed with status code 404'), {
      name: 'AxiosError',
      stack: 'AxiosError: Request failed with status code 404\n    at test.js:1:1',
      config: {
        headers: { Authorization: 'Bearer fsdaf...' },
        baseURL: 'https://prod-uswest-c.online.tableau.com/api/3.29',
        method: 'get',
      },
      code: 'ERR_BAD_REQUEST',
      status: 404,
    });

    log({
      message: 'Tool execution failed',
      level: 'error',
      logger: 'tool',
      data: mockAxiosError,
    });

    const loggedOutput = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(loggedOutput.trim());

    // Only name, message, stack, and cause should be serialized
    expect(parsed.data).toEqual({
      name: 'AxiosError',
      message: 'Request failed with status code 404',
      stack: 'AxiosError: Request failed with status code 404\n    at test.js:1:1',
    });
    // Extra fields like config, code, status should be excluded
    expect(parsed.data.config).toBeUndefined();
    expect(parsed.data.code).toBeUndefined();
    expect(parsed.data.status).toBeUndefined();
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
    expect(parseLogLevel('notice')).toBe('notice');
    expect(parseLogLevel('warning')).toBe('warning');
    expect(parseLogLevel('error')).toBe('error');
    expect(parseLogLevel('critical')).toBe('critical');
    expect(parseLogLevel('alert')).toBe('alert');
    expect(parseLogLevel('emergency')).toBe('emergency');
  });

  it('should return info for unsupported values', () => {
    expect(parseLogLevel('trace')).toBe('info');
    expect(parseLogLevel('fatal')).toBe('info');
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

describe('log() LUID fields', () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('TRANSPORT', 'http'); // route appLogger to console.log
    vi.stubEnv('ENABLED_LOGGERS', 'appLogger');
    vi.stubEnv('LOG_LEVEL', 'debug');
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const lastLine = (): Record<string, unknown> =>
    JSON.parse(stdout.mock.calls.at(-1)![0] as string);

  it('log() without ctx emits empty LUID fields', () => {
    log({ message: 'hi', level: 'info', logger: 'test' });
    expect(lastLine()).toMatchObject({ message: 'hi', site_luid: '', user_luid: '' });
  });

  it('log() with ctx emits populated LUID fields', () => {
    const ctx = { getSiteLuid: () => 'site-1', getUserLuid: () => 'user-1' };
    log({ message: 'hi', level: 'info', logger: 'test' }, ctx);
    expect(lastLine()).toMatchObject({ site_luid: 'site-1', user_luid: 'user-1' });
  });

  it('reflects lazily backfilled LUIDs (getter value changes between calls)', () => {
    let site = '';
    const ctx = { getSiteLuid: () => site, getUserLuid: () => '' };
    log({ message: 'before', level: 'info', logger: 'test' }, ctx);
    expect(lastLine()).toMatchObject({ site_luid: '' });
    site = 'site-late';
    log({ message: 'after', level: 'info', logger: 'test' }, ctx);
    expect(lastLine()).toMatchObject({ site_luid: 'site-late' });
  });

  it('injected LUID fields override caller-supplied values (anti-spoof)', () => {
    const ctx = { getSiteLuid: () => 'real', getUserLuid: () => 'real-u' };
    log(
      {
        message: 'x',
        level: 'info',
        logger: 'test',
        // @ts-expect-error caller must not be able to spoof LUIDs
        site_luid: 'spoofed',
      },
      ctx,
    );
    expect(lastLine()).toMatchObject({ site_luid: 'real' });
  });
});
