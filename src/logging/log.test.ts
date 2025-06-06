import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '../server.js';
import {
  defaultLogLevel,
  getToolLogMessage,
  isLoggingLevel,
  log,
  setLogLevel,
  shouldLogWhenLevelIsAtLeast,
  writeToStderr,
} from './log.js';

vi.mock('../server.js', () => ({
  server: {
    name: 'test-server',
    server: {
      sendLoggingMessage: vi.fn(),
    },
  },
}));

describe('log', () => {
  const originalEnv = process.env.TABLEAU_MCP_TEST;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.TABLEAU_MCP_TEST = originalEnv;
    setLogLevel(defaultLogLevel, { silent: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isLoggingLevel', () => {
    it('should return true for valid logging levels', () => {
      expect(isLoggingLevel('debug')).toBe(true);
      expect(isLoggingLevel('info')).toBe(true);
      expect(isLoggingLevel('error')).toBe(true);
    });

    it('should return false for invalid logging levels', () => {
      expect(isLoggingLevel('invalid')).toBe(false);
      expect(isLoggingLevel(123)).toBe(false);
      expect(isLoggingLevel(null)).toBe(false);
    });
  });

  describe('setLogLevel', () => {
    it('should set the log level', () => {
      setLogLevel('error', { silent: true });
      expect(shouldLogWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldLogWhenLevelIsAtLeast('debug')).toBe(false);
    });

    it('should not change level if it is the same', () => {
      const spy = vi.spyOn(server.server, 'sendLoggingMessage');
      setLogLevel('debug', { silent: true });
      setLogLevel('debug', { silent: true });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('shouldLogWhenLevelIsAtLeast', () => {
    it('should return true for levels at or above current level', () => {
      setLogLevel('warning', { silent: true });
      expect(shouldLogWhenLevelIsAtLeast('warning')).toBe(true);
      expect(shouldLogWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldLogWhenLevelIsAtLeast('info')).toBe(false);
    });
  });

  describe('writeToStderr', () => {
    it('should write to stderr in non-test mode', () => {
      process.env.TABLEAU_MCP_TEST = 'false';

      const stderrSpy = vi.spyOn(process.stderr, 'write');
      writeToStderr('test message');

      expect(stderrSpy).toHaveBeenCalledWith('test message\n');
    });

    it('should not write to stderr in test mode', () => {
      process.env.TABLEAU_MCP_TEST = 'true';

      const stderrSpy = vi.spyOn(process.stderr, 'write');
      writeToStderr('test message');

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('getToolLogMessage', () => {
    it('should create a tool log message with args', () => {
      const args = { param1: 'value1' };
      const result = getToolLogMessage({
        requestId: '2',
        toolName: 'list-fields',
        args,
      });

      expect(result).toEqual({
        type: 'tool',
        requestId: '2',
        tool: {
          name: 'list-fields',
          args,
        },
      });
    });

    it('should create a tool log message without args', () => {
      const result = getToolLogMessage({
        requestId: '2',
        toolName: 'list-fields',
        args: undefined,
      });

      expect(result).toEqual({
        type: 'tool',
        requestId: '2',
        tool: {
          name: 'list-fields',
        },
      });
    });
  });

  describe('log functions', () => {
    it('should send logging message when level is appropriate', async () => {
      setLogLevel('info', { silent: true });

      await log.info('test message', 'test-logger');

      expect(server.server.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'info',
        logger: 'test-logger',
        message: expect.stringContaining('test message'),
      });
    });

    it('should not send logging message when level is below current level', async () => {
      setLogLevel('warning', { silent: true });

      await log.debug('test message', 'test-logger');

      expect(server.server.sendLoggingMessage).not.toHaveBeenCalled();
    });

    it('should use server name as default logger', async () => {
      setLogLevel('info', { silent: true });

      await log.info('test message');

      expect(server.server.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'info',
        logger: 'test-server',
        message: expect.stringContaining('test message'),
      });
    });

    it('should handle LogMessage objects', async () => {
      setLogLevel('info', { silent: true });
      const logMessage = {
        type: 'request',
        method: 'GET',
        path: '/test',
      } as const;

      await log.info(logMessage, 'test-logger');

      expect(server.server.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'info',
        logger: 'test-logger',
        message: expect.any(String),
      });
    });
  });
});
