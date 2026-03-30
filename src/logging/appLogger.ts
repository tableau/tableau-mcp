import { getConfig } from '../config.js';

export const writeToStderr = (message: string): void => {
  if (process.env.TABLEAU_MCP_TEST === 'true') {
    // Silence logging when running in test mode
    return;
  }

  message = message.endsWith('\n') ? message : `${message}\n`;
  process.stderr.write(message);
};

/**
 * Writes a message to stdout via console.log, but only when running on the http transport
 * and appLogger is in the ENABLE_LOGGING config list.
 * On the stdio transport stdout is reserved for MCP protocol messages, so this is a no-op.
 */
export function httpInfoLog(message: string): void {
  const config = getConfig();
  if (config.transport === 'http' && config.loggers.has('appLogger')) {
    // eslint-disable-next-line no-console
    console.log(message);
  }
}

export function httpErrorLog(message: string): void {
  const config = getConfig();
  if (config.transport === 'http' && config.loggers.has('appLogger')) {
    console.error(message);
  }
}
