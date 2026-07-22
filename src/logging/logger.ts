import { getBaseConfig } from '../config.shared.js';
import { getFileLogger } from './fileLogger.js';
import { LogEntry, LogLevel, logLevelSeverity, SerializedLogEntry } from './types.js';

export function shouldLog(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  return logLevelSeverity[entryLevel] >= logLevelSeverity[minLevel];
}

function isLogLevel(value: string): value is LogLevel {
  return value in logLevelSeverity;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim();
  if (level && isLogLevel(level)) {
    return level;
  }
  return 'info';
}

/**
 * Custom JSON.stringify replacer that serializes Error objects properly.
 * Removes the config field from AxiosError to avoid logging sensitive headers.
 */
export function errorReplacer(data: unknown): unknown {
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
      ...(data.cause !== undefined && { cause: data.cause }),
    };
  }

  return data;
}

/**
 * The dedicated logger name for authoritative audit records (e.g. the mutation guard). Audit
 * records are a security control, so they bypass the LOG_LEVEL severity filter below — an operator
 * must not be able to suppress them by raising LOG_LEVEL. They still honor the appLogger/fileLogger
 * sink selection like any other entry.
 */
export const AUDIT_LOGGER = 'audit';

/** Lazy accessors for the request-scoped identifiers stamped onto every log line. */
export type LuidGetters = {
  getSiteLuid?: () => string;
  getUserLuid?: () => string;
};

/** Emits an already-enriched entry to the configured sinks. This is the former `log()` body. */
function emit(entry: SerializedLogEntry): void {
  const config = getBaseConfig();
  // Audit records always pass the severity gate; all other entries honor the configured level.
  if (entry.logger !== AUDIT_LOGGER && !shouldLog(entry.level, config.logLevel)) {
    return;
  }

  // we are removing any unnecessary fields that may also leak sensitive data
  entry.data = errorReplacer(entry.data);

  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(message);
    } else {
      process.stderr.write(message + '\n');
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}

/**
 * Stamps every log line with the request's site/user LUIDs. The default instance carries empty
 * getters (context-less lines emit ''); a per-request child (see server.web.ts) carries lazy
 * getters so PAT/direct-trust backfill after sign-in is reflected on later lines.
 */
export class Logger {
  constructor(private readonly getters: LuidGetters = {}) {}

  log(entry: LogEntry): void {
    // Injected LUID fields come AFTER the spread so a caller cannot override them, and default to ''.
    emit({
      ...entry,
      site_luid: this.getters.getSiteLuid?.() || '',
      user_luid: this.getters.getUserLuid?.() || '',
    });
  }

  child(getters: LuidGetters): Logger {
    return new Logger(getters);
  }
}

/** Module-default logger for all context-less call sites; emits empty LUID fields. */
export const logger = new Logger();

/** Backward-compatible free function retained for the ~71 context-less call sites. */
export function log(entry: LogEntry): void {
  logger.log(entry);
}
