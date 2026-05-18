import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LoggingLevel, RequestId } from '@modelcontextprotocol/sdk/types.js';

import { ToolName } from '../tools/toolName.js';
import { getFileLogger } from './fileLogger.js';
import { sanitizeForNotification } from './sanitizeNotification.js';
import { orderedLogLevels } from './types.js';

type NotificationName = 'rest-api' | (string & {});
type NotificationType = LoggingLevel | 'request' | 'response' | 'tool' | 'request-cancelled';
type NotificationMessage = {
  type: NotificationType;
  [key: string]: any;
};

export const notificationLevels = orderedLogLevels;

let currentNotificationLevel: LoggingLevel = 'debug';

export function isNotificationLevel(level: unknown): level is LoggingLevel {
  return !!notificationLevels.find((l) => l === level);
}

export const setNotificationLevel = (
  mcpServer: McpServer,
  level: LoggingLevel,
  { silent = false }: { silent?: boolean } = {},
): void => {
  if (currentNotificationLevel === level) {
    return;
  }

  currentNotificationLevel = level;

  if (!silent) {
    notifier.notice(mcpServer, `Logging level set to: ${level}`);
  }
};

type NotificationMethodOptions = Partial<{ notifier: NotificationName; requestId: RequestId }>;

export const notifier = {
  debug: getSendNotificationMessageFn('debug'),
  info: getSendNotificationMessageFn('info'),
  notice: getSendNotificationMessageFn('notice'),
  warning: getSendNotificationMessageFn('warning'),
  error: getSendNotificationMessageFn('error'),
  critical: getSendNotificationMessageFn('critical'),
  alert: getSendNotificationMessageFn('alert'),
  emergency: getSendNotificationMessageFn('emergency'),
} satisfies {
  [level in LoggingLevel]: (
    mcpServer: McpServer,
    message: string | NotificationMessage,
    { notifier, requestId }: NotificationMethodOptions,
  ) => Promise<void>;
};

export const shouldNotifyWhenLevelIsAtLeast = (level = currentNotificationLevel): boolean => {
  return notificationLevels.indexOf(level) >= notificationLevels.indexOf(currentNotificationLevel);
};

export const getNotificationMessageForTool = ({
  requestId,
  toolName,
  args,
  username,
}: {
  requestId: RequestId;
  toolName: ToolName;
  args: unknown;
  username?: string;
}): NotificationMessage => {
  return {
    type: 'tool',
    requestId,
    ...(username ? { username } : {}),
    tool: {
      name: toolName,
      ...(args !== undefined ? { args } : {}),
    },
  };
};

function getSendNotificationMessageFn(level: LoggingLevel) {
  return async (
    mcpServer: McpServer,
    message: string | NotificationMessage,
    { notifier, requestId }: NotificationMethodOptions = { notifier: 'tableau-mcp' },
  ) => {
    const sanitizedMessage = sanitizeForNotification(message);
    const fileLogMessage =
      typeof sanitizedMessage === 'string'
        ? sanitizedMessage
        : safeStringifyNotificationMessage(sanitizedMessage);
    getFileLogger()?.log({
      message: fileLogMessage,
      level,
      logger: notifier,
    });

    if (!shouldNotifyWhenLevelIsAtLeast(level)) {
      return;
    }

    // server.sendNotification doesn't provide a way to provide the relatedRequestId
    // so we're using server.notification directly.
    return mcpServer.server.notification(
      {
        method: 'notifications/message',
        params: {
          level,
          notifier,
          data: JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              currentNotificationLevel,
              notifier,
              message: sanitizedMessage,
            },
            null,
            2,
          ),
        },
      },
      {
        relatedRequestId: requestId,
      },
    );
  };
}

function safeStringifyNotificationMessage(message: unknown): string {
  try {
    return JSON.stringify(message);
  } catch {
    return '[Unable to serialize notification message]';
  }
}
