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
