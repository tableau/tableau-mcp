export type LogLevel = 'debug' | 'info' | 'error';

export type LogEntry = {
  message: string;
  error?: unknown;
  level: LogLevel;
  logger: string | undefined;
};
