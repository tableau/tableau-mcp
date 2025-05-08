import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

import { server } from './server.js';

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
export const setLogLevel = (level: LoggingLevel): void => {
  currentLogLevel = level;
  log.debug(`Logging level set to: ${level}`);
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
} satisfies LogLevelMap<(message: string) => Promise<void>>;

function getSendLoggingMessageFn(level: LoggingLevel) {
  return async (message: string) => {
    if (orderedLevels[level] < orderedLevels[currentLogLevel]) {
      return;
    }

    return server.server.sendLoggingMessage({ level, message });
  };
}
