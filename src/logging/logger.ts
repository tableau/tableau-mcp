import { getConfig } from '../config.js';
import { getFileLogger, LogEntry } from './fileLogger.js';

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
