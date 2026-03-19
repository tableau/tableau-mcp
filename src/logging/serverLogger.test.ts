import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loggingLevels } from './log.js';
import { ServerLogger } from './serverLogger.js';

const logLineSchema = z.object({
  timestamp: z.coerce.date(),
  message: z.string().or(z.record(z.string(), z.any())),
  level: z.enum(loggingLevels),
  logger: z.string(),
});

describe('ServerLogger', () => {
  const testLogDirectory = 'test-logs';
  const logger = 'test-logger';

  let serverLogger: ServerLogger;

  beforeEach(() => {
    // Clean up any existing test directory
    if (existsSync(testLogDirectory)) {
      rmSync(testLogDirectory, { recursive: true, force: true });
    }

    serverLogger = new ServerLogger({ logDirectory: testLogDirectory });
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

    await serverLogger.log({ message, level, logger });

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

  it('should handle concurrent log writes to the same file', async () => {
    const message1 = 'First concurrent message';
    const message2 = 'Second concurrent message';
    const message3 = 'Third concurrent message';
    const level = 'info';

    const messages = [message1, message2, message3];

    // Wait for all operations to complete
    await Promise.all(messages.map((message) => serverLogger.log({ message, level, logger })));

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
    await Promise.all(messages.map((message) => serverLogger.log({ message, level, logger })));

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
    const messages: Array<{ message: string; level: LoggingLevel }> = [
      { message: 'Debug message', level: 'debug' },
      { message: 'Info message', level: 'info' },
      { message: 'Warning message', level: 'warning' },
      { message: 'Error message', level: 'error' },
    ];

    for (const { message, level } of messages) {
      await serverLogger.log({ message, level, logger });
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
