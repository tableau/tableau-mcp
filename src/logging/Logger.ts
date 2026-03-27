import { getConfig } from '../config.js';
import { getFileLogger, LogEntry } from './fileLogger.js';

export const LoggerType = {
  FileLogger: 'fileLogger',
  AppLogger: 'appLogger',
} as const;

export type LoggerType = (typeof LoggerType)[keyof typeof LoggerType];

const validLoggerTypes = new Set<string>(Object.values(LoggerType));

export function parseLoggerTypes(value: string | undefined): Set<LoggerType> {
  if (!value) {
    return new Set([LoggerType.AppLogger]);
  }
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is LoggerType => validLoggerTypes.has(s)),
  );
}

export const writeToStderr = (message: string): void => {
  if (process.env.TABLEAU_MCP_TEST === 'true') {
    // Silence logging when running in test mode
    return;
  }

  message = message.endsWith('\n') ? message : `${message}\n`;
  process.stderr.write(message);
};

export function log(entry: LogEntry): void {
  const config = getConfig();
  if (config.transport === 'http' && config.enableLogging.has(LoggerType.AppLogger)) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
  const fileLogger = getFileLogger();
  if (config.enableLogging.has(LoggerType.FileLogger) && fileLogger) {
    fileLogger.log(entry);
  }
}
