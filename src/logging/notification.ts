import { LoggingLevel, RequestId } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../server.js';
import { ToolName } from '../tools/toolName.js';
import { getFileLogger } from './fileLogger.js';

type LoggerName = 'rest-api' | (string & {});
type LogType = LoggingLevel | 'request' | 'response' | 'tool' | 'request-cancelled';
type LogMessage = {
  type: LogType;
  [key: string]: any;
};

export const loggingLevels = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

let currentLogLevel: LoggingLevel = 'debug';

export function isLoggingLevel(level: unknown): level is LoggingLevel {
  return !!loggingLevels.find((l) => l === level);
}

export const setLogLevel = (
  server: Server,
  level: LoggingLevel,
  { silent = false }: { silent?: boolean } = {},
): void => {
  if (currentLogLevel === level) {
    return;
  }

  currentLogLevel = level;

  if (!silent) {
    log.notice(server, `Logging level set to: ${level}`);
  }
};

type LogMethodOptions = Partial<{ logger: LoggerName; requestId: RequestId }>;

export const log = {
  debug: getSendLoggingMessageFn('debug'),
  info: getSendLoggingMessageFn('info'),
  notice: getSendLoggingMessageFn('notice'),
  warning: getSendLoggingMessageFn('warning'),
  error: getSendLoggingMessageFn('error'),
  critical: getSendLoggingMessageFn('critical'),
  alert: getSendLoggingMessageFn('alert'),
  emergency: getSendLoggingMessageFn('emergency'),
} satisfies {
  [level in LoggingLevel]: (
    server: Server,
    message: string | LogMessage,
    { logger, requestId }: LogMethodOptions,
  ) => Promise<void>;
};

export const shouldLogWhenLevelIsAtLeast = (level = currentLogLevel): boolean => {
  return loggingLevels.indexOf(level) >= loggingLevels.indexOf(currentLogLevel);
};

export const getToolLogMessage = ({
  requestId,
  toolName,
  args,
  username,
}: {
  requestId: RequestId;
  toolName: ToolName;
  args: unknown;
  username?: string;
}): LogMessage => {
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

function getSendLoggingMessageFn(level: LoggingLevel) {
  return async (
    server: Server,
    message: string | LogMessage,
    { logger, requestId }: LogMethodOptions = {
      logger: server.name,
    },
  ) => {
    getFileLogger()?.log({ message, level, logger });

    if (!shouldLogWhenLevelIsAtLeast(level)) {
      return;
    }

    // server.sendNotification doesn't provide a way to provide the relatedRequestId
    // so we're using server.notification directly.
    return server.server.notification(
      {
        method: 'notifications/message',
        params: {
          level,
          logger,
          data: JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              currentLogLevel,
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
