import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FileLogger } from './fileLogger.js';
import type { LogLevel } from './types.js';

const logLineSchema = z.object({
  timestamp: z.coerce.date(),
  message: z.string().or(z.record(z.string(), z.any())),
  level: z.string(),
  logger: z.string(),
});

describe('FileLogger', () => {
  const testLogDirectory = 'test-logs';
  const logger = 'test-logger';

  let fileLogger: FileLogger;

  beforeEach(() => {
    // Clean up any existing test directory
    if (existsSync(testLogDirectory)) {
      rmSync(testLogDirectory, { recursive: true, force: true });
    }

    fileLogger = new FileLogger({ logDirectory: testLogDirectory });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testLogDirectory)) {
      rmSync(testLogDirectory, { recursive: true, force: true });
    }
  });

  it('should create log directory if it does not exist', () => {
    expect(existsSync(testLogDirectory)).toBe(true);
  });

  it('should write log messages to file', async () => {
    const message = 'Test log message';
    const level = 'info';

    await fileLogger.log({ message, level, logger });

    // Find the log file (it will have a timestamp-based name)
    const files = readdirSync(testLogDirectory);
    expect(files.length).toBe(1);

    const logFile = join(testLogDirectory, files[0]);
    const logLines = readFileSync(logFile).toString().split('\n').filter(Boolean);
    expect(logLines.length).toBe(1);

    const logObject = logLineSchema.parse(JSON.parse(logLines[0]));
    expect(logObject.message).toBe(message);
    expect(logObject.level).toBe(level);
    expect(logObject.logger).toBe(logger);
  });

  it('should prefix log file names when fileNamePrefix is set', async () => {
    const prefixedLogger = new FileLogger({
      logDirectory: testLogDirectory,
      fileNamePrefix: 'desktop-mcp-',
    });

    await prefixedLogger.log({ message: 'Prefixed message', level: 'info', logger });

    const files = readdirSync(testLogDirectory);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^desktop-mcp-.*\.log$/);
  });

  it('should handle concurrent log writes to the same file', async () => {
    const message1 = 'First concurrent message';
    const message2 = 'Second concurrent message';
    const message3 = 'Third concurrent message';
    const level = 'info';

    const messages = [message1, message2, message3];

    // Wait for all operations to complete
    await Promise.all(messages.map((message) => fileLogger.log({ message, level, logger })));

    // Find the log file
    const files = readdirSync(testLogDirectory);

    // If the write operations occurred exactly on the hour boundary, there would be two files.
    // This is incredibly unlikely, but if there are two files, let's just merge them.
    expect(files.length).toBeLessThanOrEqual(2);

    const logLines = files.flatMap((file) => {
      const logFile = join(testLogDirectory, file);
      const logLines = readFileSync(logFile).toString().split('\n').filter(Boolean);
      return logLines;
    });

    expect(logLines.length).toBe(3);

    for (let line = 0; line < logLines.length; line++) {
      const logObject = logLineSchema.parse(JSON.parse(logLines[line]));
      expect(logObject.message).toBe(messages[line]);
      expect(logObject.level).toBe(level);
      expect(logObject.logger).toBe(logger);
    }
  });

  it('should handle high concurrency without data corruption', async () => {
    const numConcurrentLogs = 50;
    const baseMessage = 'Concurrent log message';
    const level = 'info';

    const messages = Array.from({ length: numConcurrentLogs }, (_, i) => `${baseMessage} ${i}`);

    // Create many concurrent log operations
    await Promise.all(messages.map((message) => fileLogger.log({ message, level, logger })));

    // Find the log file
    const files = readdirSync(testLogDirectory);

    // If the write operations occurred exactly on the hour boundary, there would be two files.
    // This is incredibly unlikely, but if there are two files, let's just merge them.
    expect(files.length).toBeLessThanOrEqual(2);

    const logLines = files.flatMap((file) => {
      const logFile = join(testLogDirectory, file);
      const logLines = readFileSync(logFile).toString().split('\n').filter(Boolean);
      return logLines;
    });

    expect(logLines.length).toBe(numConcurrentLogs);

    for (let line = 0; line < logLines.length; line++) {
      const logObject = logLineSchema.parse(JSON.parse(logLines[line]));
      expect(logObject.message).toBe(messages[line]);
      expect(logObject.level).toBe(level);
      expect(logObject.logger).toBe(logger);
    }
  });

  it('should handle different log levels correctly', async () => {
    const messages: Array<{ message: string; level: LogLevel }> = [
      { message: 'Debug message', level: 'debug' },
      { message: 'Info message', level: 'info' },
      { message: 'Error message', level: 'error' },
    ];

    for (const { message, level } of messages) {
      await fileLogger.log({ message, level, logger });
    }

    // Find the log file
    const files = readdirSync(testLogDirectory);

    // If the write operations occurred exactly on the hour boundary, there would be two files.
    // This is incredibly unlikely, but if there are two files, let's just merge them.
    expect(files.length).toBeLessThanOrEqual(2);

    const logLines = files.flatMap((file) => {
      const logFile = join(testLogDirectory, file);
      const logLines = readFileSync(logFile).toString().split('\n').filter(Boolean);
      return logLines;
    });

    expect(logLines.length).toBe(messages.length);

    for (let line = 0; line < logLines.length; line++) {
      const logObject = logLineSchema.parse(JSON.parse(logLines[line]));
      expect(logObject.message).toBe(messages[line].message);
      expect(logObject.level).toBe(messages[line].level);
      expect(logObject.logger).toBe(logger);
    }
  });
});

const withTimeZone = async <T>(tz: string, fn: () => Promise<T>): Promise<T> => {
  vi.stubEnv('TZ', tz);
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe('FileLogger hourly file name', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-logger-name-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('names the file by the UTC hour even in a half-hour time zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-20T05:15:00.000Z'));

    await withTimeZone('Asia/Kolkata', () =>
      new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).log({
        message: 'm',
        level: 'info',
        logger: 'test-logger',
      }),
    );

    expect(readdirSync(dir)).toEqual(['desktop-mcp-2026-06-20T05-00-00-000Z.log']);
  });
});

describe('FileLogger.pruneOldLogs', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-20T10:30:00.000Z');
  const hourName = (prefix: string, date: Date): string =>
    `${prefix}${new Date(date.getTime()).toISOString().slice(0, 13)}-00-00-000Z.log`;

  let dir: string;

  const seed = (names: Array<string>): void => {
    for (const name of names) writeFileSync(join(dir, name), 'x\n');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-logger-prune-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes only desktop-prefixed hour files older than the retention window', async () => {
    const old15 = hourName('desktop-mcp-', new Date(now.getTime() - 15 * DAY_MS));
    const young13 = hourName('desktop-mcp-', new Date(now.getTime() - 13 * DAY_MS));
    const current = hourName('desktop-mcp-', now);
    const keep = [
      young13,
      current,
      'ask-ledger.jsonl',
      'tab-agent.log',
      'web-mcp.log',
      'episodes-x.jsonl',
      '2026-01-01T00-00-00-000Z.log',
      'desktop-mcp-2026-01-01.log',
      'desktop-mcp-2026-01-01T00-00-00-000Z.log.bak',
    ];
    seed([old15, ...keep]);

    await new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).pruneOldLogs({
      maxAgeDays: 14,
      now,
    });

    expect(readdirSync(dir).sort()).toEqual([...keep].sort());
  });

  it('reads the age from the UTC time in the name, even under a non-UTC time zone', async () => {
    // Cutoff is 2026-06-06T05:30Z: the 05:00Z file is older, the 06:00Z file is newer.
    const older = 'desktop-mcp-2026-06-06T05-00-00-000Z.log';
    const newer = 'desktop-mcp-2026-06-06T06-00-00-000Z.log';
    seed([older, newer]);

    await withTimeZone('Asia/Kolkata', () =>
      new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).pruneOldLogs({
        maxAgeDays: 14,
        now: new Date('2026-06-20T05:30:00.000Z'),
      }),
    );

    expect(readdirSync(dir)).toEqual([newer]);
  });

  it('prunes half-hour names already written by older versions in non-UTC zones', async () => {
    const older = 'desktop-mcp-2026-06-05T04-30-00-000Z.log';
    const recent = 'desktop-mcp-2026-06-19T04-30-00-000Z.log';
    seed([older, recent]);

    await new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).pruneOldLogs({
      maxAgeDays: 14,
      now,
    });

    expect(readdirSync(dir)).toEqual([recent]);
  });

  it('never deletes the current hour file even with a tiny window', async () => {
    const current = hourName('desktop-mcp-', now);
    seed([current]);

    await new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).pruneOldLogs({
      maxAgeDays: 0.0001,
      now,
    });

    expect(readdirSync(dir)).toEqual([current]);
  });

  it.each([0, -1, NaN, Infinity])('deletes nothing when maxAgeDays is %s', async (maxAgeDays) => {
    const ancient = 'desktop-mcp-2020-01-01T00-00-00-000Z.log';
    seed([ancient]);

    await new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' }).pruneOldLogs({
      maxAgeDays,
      now,
    });

    expect(readdirSync(dir)).toEqual([ancient]);
  });

  it('deletes nothing when the prefix is empty', async () => {
    const ancient = '2020-01-01T00-00-00-000Z.log';
    seed([ancient]);

    await new FileLogger({ logDirectory: dir }).pruneOldLogs({ maxAgeDays: 14, now });

    expect(readdirSync(dir)).toEqual([ancient]);
  });

  it('resolves without throwing when the directory is gone', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fileLogger = new FileLogger({ logDirectory: dir, fileNamePrefix: 'desktop-mcp-' });
    rmSync(dir, { recursive: true, force: true });

    await expect(fileLogger.pruneOldLogs({ maxAgeDays: 14, now })).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledTimes(1);
    stderr.mockRestore();
  });
});
