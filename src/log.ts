import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

import { server } from './server.js';

type Logger = 'rest-api' | (string & {});
type LogType = LoggingLevel | 'request' | 'response';
type LogMessage = {
  type: LogType;
  currentLogLevel: LoggingLevel;
  [key: string]: any;
};

type LogLevelMap<T> = {
  [level in LoggingLevel]: T;
};

const orderedLevels = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
} satisfies LogLevelMap<number>;

let currentLogLevel: LoggingLevel = 'debug';

export const getCurrentLogLevel = (): LoggingLevel => currentLogLevel;
export const setLogLevel = (level: LoggingLevel): void => {
  currentLogLevel = level;
  log.notice(`Logging level set to: ${level}`);
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
} satisfies LogLevelMap<(message: LogMessage, logger: Logger) => Promise<void>>;

export const shouldLogWhenLevelIsAtLeast = (level = currentLogLevel): boolean => {
  return orderedLevels[level] >= orderedLevels[currentLogLevel];
};

function getSendLoggingMessageFn(level: LoggingLevel) {
  return async (message: string | LogMessage, logger: Logger = server.name) => {
    if (!shouldLogWhenLevelIsAtLeast(level)) {
      return;
    }

    return server.server.sendLoggingMessage({
      level,
      logger,
      message:
        typeof message === 'string' || message instanceof String
          ? message
          : JSON.stringify(message, null, 2),
    });
  };
}
