import { join } from 'path';

import { removeClaudeMcpBundleUserConfigTemplates } from './config.shared';
import { LoggerType, parseLoggerTypes } from './logging/logger';

export class Config {
  transport: 'stdio';
  defaultLogLevel: string;
  loggers: Set<LoggerType>;
  fileLoggerDirectory: string;

  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      ENABLED_LOGGERS: logging,
      FILE_LOGGER_DIRECTORY: fileLoggerDirectory,
    } = cleansedVars;

    this.transport = 'stdio';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.loggers = parseLoggerTypes(logging);
    this.fileLoggerDirectory = fileLoggerDirectory || join(__dirname, 'logs');
  }
}

export const getDesktopConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
