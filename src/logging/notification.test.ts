import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebMcpServer } from '../server.web.js';
import { getFileLogger } from './fileLogger.js';
import {
  getNotificationMessageForTool,
  isNotificationLevel,
  notifier,
  setNotificationLevel,
  shouldNotifyWhenLevelIsAtLeast,
} from './notification.js';

vi.mock('./fileLogger.js', () => ({
  getFileLogger: vi.fn(),
}));

type NotificationPayloadWithData = {
  params: {
    data: string;
  };
};

describe('notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileLogger).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      setNotificationLevel(new WebMcpServer().mcpServer, 'error', { silent: true });
      expect(shouldNotifyWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('debug')).toBe(false);
    });

    it('should not change level if it is the same', () => {
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'debug', { silent: true });
      setNotificationLevel(server.mcpServer, 'debug', { silent: true });
      expect(server.mcpServer.server.notification).not.toHaveBeenCalled();
    });
  });

  describe('shouldLogWhenLevelIsAtLeast', () => {
    it('should return true for levels at or above current level', () => {
      setNotificationLevel(new WebMcpServer().mcpServer, 'warning', { silent: true });
      expect(shouldNotifyWhenLevelIsAtLeast('warning')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('error')).toBe(true);
      expect(shouldNotifyWhenLevelIsAtLeast('info')).toBe(false);
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
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'info', { silent: true });

      await notifier.info(server.mcpServer, 'test message', { notifier: 'test-logger' });

      expect(server.mcpServer.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            notifier: 'test-logger',
            data: expect.stringContaining('test message'),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });

    it('should not send logging message when level is below current level', async () => {
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'warning', { silent: true });

      await notifier.debug(server.mcpServer, 'test message', { notifier: 'test-logger' });

      expect(server.mcpServer.server.notification).not.toHaveBeenCalled();
    });

    it('should use tableau-mcp as default logger', async () => {
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'info', { silent: true });

      await notifier.info(server.mcpServer, 'test message');

      expect(server.mcpServer.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            notifier: 'tableau-mcp',
            data: expect.stringContaining('test message'),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });

    it('should handle LogMessage objects', async () => {
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'info', { silent: true });
      const logMessage = {
        type: 'request',
        method: 'GET',
        path: '/test',
      } as const;

      await notifier.info(server.mcpServer, logMessage, { notifier: 'test-logger' });

      expect(server.mcpServer.server.notification).toHaveBeenCalledWith(
        {
          method: 'notifications/message',
          params: {
            level: 'info',
            notifier: 'test-logger',
            data: expect.any(String),
          },
        },
        {
          relatedRequestId: undefined,
        },
      );
    });

    it('should use sanitized messages for file logging and MCP notifications', async () => {
      const server = new WebMcpServer();
      const fileLogger = { log: vi.fn() };
      vi.mocked(getFileLogger).mockReturnValue(fileLogger as never);
      setNotificationLevel(server.mcpServer, 'info', { silent: true });
      const message = {
        type: 'response',
        data: Buffer.from([137, 80, 78, 71]),
      } as const;

      await notifier.info(server.mcpServer, message, { notifier: 'rest-api' });

      expect(fileLogger.log).toHaveBeenCalledWith({
        message: JSON.stringify({
          type: 'response',
          data: {
            redacted: true,
            reason: 'binary-payload',
            message: '[redacted binary payload]',
            kind: 'Buffer',
            byteLength: 4,
          },
        }),
        level: 'info',
        logger: 'rest-api',
      });

      const notificationPayload = vi.mocked(server.mcpServer.server.notification).mock
        .calls[0][0] as NotificationPayloadWithData;
      const notificationData = JSON.parse(notificationPayload.params.data);
      expect(notificationData.message).toEqual({
        type: 'response',
        data: {
          redacted: true,
          reason: 'binary-payload',
          message: '[redacted binary payload]',
          kind: 'Buffer',
          byteLength: 4,
        },
      });
      expect(notificationPayload.params.data).not.toContain('"0":137');
    });

    it('should preserve small normal notification messages', async () => {
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'info', { silent: true });
      const message = {
        type: 'response',
        status: 200,
        data: { message: 'ok' },
      } as const;

      await notifier.info(server.mcpServer, message, { notifier: 'rest-api' });

      const notificationPayload = vi.mocked(server.mcpServer.server.notification).mock
        .calls[0][0] as NotificationPayloadWithData;
      const notificationData = JSON.parse(notificationPayload.params.data);
      expect(notificationData.message).toEqual(message);
    });

    it('should use the configured notification payload max bytes', async () => {
      vi.stubEnv('NOTIFICATION_PAYLOAD_MAX_BYTES', '12');
      const server = new WebMcpServer();
      setNotificationLevel(server.mcpServer, 'info', { silent: true });

      await notifier.info(
        server.mcpServer,
        {
          type: 'response',
          data: 'notification payload',
        },
        { notifier: 'rest-api' },
      );

      const notificationPayload = vi.mocked(server.mcpServer.server.notification).mock
        .calls[0][0] as NotificationPayloadWithData;
      const notificationData = JSON.parse(notificationPayload.params.data);
      expect(notificationData.message).toEqual({
        type: 'response',
        data: {
          truncated: true,
          reason: 'oversized-string',
          message: '[truncated oversized string]',
          value: 'notification',
          originalLength: 20,
          threshold: 12,
        },
      });
    });
  });
});
