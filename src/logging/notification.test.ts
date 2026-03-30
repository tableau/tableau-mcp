import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Server } from '../server.js';
import { writeToStderr } from './logger.js';
import {
  getNotificationMessageForTool,
  isNotificationLevel,
  notifier,
  setNotificationLevel,
  shouldNotifyWhenLevelIsAtLeast,
} from './notification.js';

describe('notification', () => {
  const originalEnv = process.env.TABLEAU_MCP_TEST;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.TABLEAU_MCP_TEST = originalEnv;
  });

  describe('isLoggingLevel', () => {
    it('should return true for valid logging levels', () => {
      expect(isNotificationLevel('debug')).toBe(true);
      expect(isNotificationLevel('info')).toBe(true);
      expect(isNotificationLevel('error')).toBe(true);
    });

    it('should return false for invalid logging levels', () => {
      expect(isNotificationLevel('invalid')).toBe(false);
      expect(isNotificationLevel(123)).toBe(false);
      expect(isNotificationLevel(null)).toBe(false);
    });
  });

  describe('setLogLevel', () => {
    it('should set the log level', () => {
      setNotificationLevel(new Server(), 'error', { silent: true });
      expect(shouldNotifyWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('debug')).toBe(false);
    });

    it('should not change level if it is the same', () => {
      const server = new Server();
      setNotificationLevel(server, 'debug', { silent: true });
      setNotificationLevel(server, 'debug', { silent: true });
      expect(server.server.notification).not.toHaveBeenCalled();
    });
  });

  describe('shouldLogWhenLevelIsAtLeast', () => {
    it('should return true for levels at or above current level', () => {
      setNotificationLevel(new Server(), 'warning', { silent: true });
      expect(shouldNotifyWhenLevelIsAtLeast('warning')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('info')).toBe(false);
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
      const result = getNotificationMessageForTool({
        requestId: '2',
        toolName: 'get-datasource-metadata',
        args,
      });

      expect(result).toEqual({
        type: 'tool',
        requestId: '2',
        tool: {
          name: 'get-datasource-metadata',
          args,
        },
      });
    });

    it('should create a tool log message without args', () => {
      const result = getNotificationMessageForTool({
        requestId: '2',
        toolName: 'get-datasource-metadata',
        args: undefined,
      });

      expect(result).toEqual({
        type: 'tool',
        requestId: '2',
        tool: {
          name: 'get-datasource-metadata',
        },
      });
    });
  });

  describe('log functions', () => {
    it('should send logging message when level is appropriate', async () => {
      const server = new Server();
      setNotificationLevel(server, 'info', { silent: true });

      await notifier.info(server, 'test message', { notifier: 'test-logger' });

      expect(server.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            logger: 'test-logger',
            data: expect.stringContaining('test message'),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });

    it('should not send logging message when level is below current level', async () => {
      const server = new Server();
      setNotificationLevel(server, 'warning', { silent: true });

      await notifier.debug(server, 'test message', { notifier: 'test-logger' });

      expect(server.server.notification).not.toHaveBeenCalled();
    });

    it('should use server name as default logger', async () => {
      const server = new Server();
      setNotificationLevel(server, 'info', { silent: true });

      await notifier.info(server, 'test message');

      expect(server.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            logger: 'test-server',
            data: expect.stringContaining('test message'),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });

    it('should handle LogMessage objects', async () => {
      const server = new Server();
      setNotificationLevel(server, 'info', { silent: true });
      const logMessage = {
        type: 'request',
        method: 'GET',
        path: '/test',
      } as const;

      await notifier.info(server, logMessage, { notifier: 'test-logger' });

      expect(server.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            logger: 'test-logger',
            data: expect.any(String),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });
  });
});
