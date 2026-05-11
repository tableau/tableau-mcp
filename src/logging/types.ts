import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

export type LogLevel = LoggingLevel;
export const orderedLogLevels = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

export const logLevelSeverity = Object.fromEntries(
  orderedLogLevels.map((level, index) => [level, index]),
) as Record<LogLevel, number>;

export type LogEntry = {
  message: string;
  data?: unknown;
  level: LogLevel;
  logger: string | undefined;
};
