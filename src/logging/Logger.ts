import { getConfig } from '../config.js';
import { FileLogger } from './fileLogger.js';

export const writeToStderr = (message: string): void => {
  if (process.env.TABLEAU_MCP_TEST === 'true') {
    // Silence logging when running in test mode
    return;
  }

  message = message.endsWith('\n') ? message : `${message}\n`;
  process.stderr.write(message);
};

export function httpErrorLog(message: string): void {
  const config = getConfig();
  if (config.transport === 'http' && config.enableLogging.has('appLogger')) {
    console.error(message);
  }
}

/**
 * Logs a message to all enabled outputs:
 * - disk via FileLogger (when fileLogger is in ENABLE_LOGGING)
 * - stdout via console.log (when appLogger is in ENABLE_LOGGING and transport is http)
 */
export class Logger {
  private readonly _fileLogger: FileLogger | undefined;

  constructor({ fileLogger }: { fileLogger?: FileLogger } = {}) {
    this._fileLogger = fileLogger;
  }

  log(message: string): void {
    void this._fileLogger?.log({ message });
    const config = getConfig();
    if (config.transport === 'http' && config.enableLogging.has('appLogger')) {
      // eslint-disable-next-line no-console
      console.log(message);
    }
  }
}
