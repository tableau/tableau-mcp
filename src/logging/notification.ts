import { LoggingLevel, RequestId } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../server.js';
import { ToolName } from '../tools/toolName.js';
import { getFileLogger } from './fileLogger.js';

type NotificationName = 'rest-api' | (string & {});
type NotificationType = LoggingLevel | 'request' | 'response' | 'tool' | 'request-cancelled';
type NotificationMessage = {
  type: NotificationType;
  [key: string]: any;
};

export const notificationLevels = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

let currentNotificationLevel: LoggingLevel = 'debug';

export function isNotificationLevel(level: unknown): level is LoggingLevel {
  return !!notificationLevels.find((l) => l === level);
}

export const setNotificationLevel = <TServer extends Server>(
  server: TServer,
  level: LoggingLevel,
  { silent = false }: { silent?: boolean } = {},
): void => {
  if (currentNotificationLevel === level) {
    return;
  }

  currentNotificationLevel = level;

  if (!silent) {
    notifier.notice(server, `Logging level set to: ${level}`);
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
    server: Server,
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
    server: Server,
    message: string | NotificationMessage,
    { notifier: notifier, requestId }: NotificationMethodOptions = {
      notifier: server.name,
    },
  ) => {
    getFileLogger()?.log({ message, level, logger: notifier });

    if (!shouldNotifyWhenLevelIsAtLeast(level)) {
      return;
    }

    // server.sendNotification doesn't provide a way to provide the relatedRequestId
    // so we're using server.notification directly.
    return server.server.notification(
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
              message,
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
