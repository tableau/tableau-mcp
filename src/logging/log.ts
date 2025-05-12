import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

import { server } from '../server.js';

type Logger = 'rest-api' | (string & {});
type LogType = LoggingLevel | 'request' | 'response';
type LogMessage = {
  type: LogType;
  [key: string]: any;
};

const loggingLevels = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

export const defaultLogLevel: LoggingLevel = 'debug';
let currentLogLevel: LoggingLevel = defaultLogLevel;

export function isLoggingLevel(level: unknown): level is LoggingLevel {
  return !!loggingLevels.find((l) => l === level);
}

export const setLogLevel = (
  level: LoggingLevel,
  { silent = false }: { silent?: boolean } = {},
): void => {
  if (currentLogLevel === level) {
    return;
  }

  currentLogLevel = level;

  if (!silent) {
    log.notice(`Logging level set to: ${level}`);
  }
};

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
  [level in LoggingLevel]: (message: string | LogMessage, logger: Logger) => Promise<void>;
};

export const shouldLogWhenLevelIsAtLeast = (level = currentLogLevel): boolean => {
  return loggingLevels.indexOf(level) >= loggingLevels.indexOf(currentLogLevel);
};

function getSendLoggingMessageFn(level: LoggingLevel) {
  return async (message: string | LogMessage, logger: Logger = server.name) => {
    if (!shouldLogWhenLevelIsAtLeast(level)) {
      return;
    }

    return server.server.sendLoggingMessage({
      level,
      logger,
      message: JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          currentLogLevel,
          message,
        },
        null,
        2,
      ),
    });
  };
}
