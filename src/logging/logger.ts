import { getConfig } from '../config.js';
import { getFileLogger, LogEntry } from './fileLogger.js';

export const loggerTypes = ['fileLogger', 'appLogger'] as const;
export type LoggerType = (typeof loggerTypes)[number];
const validLoggerTypes = new Set(loggerTypes);

export function parseLoggerTypes(value: string | undefined): Set<LoggerType> {
  if (!value) {
    return new Set<LoggerType>(['appLogger']);
  }
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is LoggerType => validLoggerTypes.has(s as LoggerType)),
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
  if (config.transport === 'http' && config.loggers.has('appLogger')) {
    // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
    console.log(JSON.stringify(entry));
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}
