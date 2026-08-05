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

// A LogEntry as serialized to a sink, including the always-on LUID fields log() injects.
export type SerializedLogEntry = LogEntry & {
  site_luid: string;
  user_luid: string;
};
