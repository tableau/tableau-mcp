import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import {
  AbstractCeppEventRecorder,
  CeppEventRecord,
  CeppEventRecorderConfig,
  CeppLogger,
  ICeppEventRecorder,
} from './sdk/index.js';

/** Logger name stamped on every ActivityLog line so operators can grep/route it. */
export const ACTIVITY_LOG_LOGGER = 'activityLog';

/**
 * TMCP's ActivityLog recorder abstraction. Call sites depend on this, not on the
 * vendored SDK types directly, so the event sink can be replaced without touching
 * them. Structurally identical to the SDK's `ICeppEventRecorder`.
 */
export type ActivityLogRecorder = ICeppEventRecorder;

/**
 * Bridges the SDK's internal `CeppLogger` (used only for suppressed-I/O-error
 * reporting) to the TMCP logger, so those diagnostics land in the same stream as
 * everything else instead of `console`.
 */
const tmcpCeppLogger: CeppLogger = {
  info: (message) => log({ message, level: 'debug', logger: ACTIVITY_LOG_LOGGER }),
  warn: (message) => log({ message, level: 'warning', logger: ACTIVITY_LOG_LOGGER }),
  error: (message) => log({ message, level: 'error', logger: ACTIVITY_LOG_LOGGER }),
};

/**
 * Stub ActivityLog sink: serializes each built CEPP event and writes it through the
 * TMCP logger at debug level. Nothing leaves the process — TMCP has no CEPP endpoint
 * or credentials yet. Swapping in a real transport later is a single new
 * `AbstractCeppEventRecorder` subclass that overrides `emitRecord()`; no call site
 * changes.
 */
export class LoggingActivityLogRecorder extends AbstractCeppEventRecorder {
  protected emitRecord(record: CeppEventRecord): void {
    log({
      message: 'ActivityLog event recorded',
      level: 'debug',
      logger: ACTIVITY_LOG_LOGGER,
      data: record.toJSON(),
    });
  }
}

/**
 * Builds the ActivityLog recorder from TMCP config. `recordingEnabled` is wired to
 * `ACTIVITY_LOG_ENABLED`, so a recorder built while the flag is off is a safe no-op
 * even if a caller forgets to gate first.
 */
export function createActivityLogRecorder(config: Config): ActivityLogRecorder {
  const recorderConfig: CeppEventRecorderConfig = {
    recordingEnabled: config.activityLogEnabled,
    // TMCP targets Tableau Cloud; a real wiring would derive this from the server type.
    tableauOnline: true,
    // Recording an ActivityLog event must never surface an I/O failure to a tool call.
    ioErrorSuppressionEnabled: true,
  };
  return new LoggingActivityLogRecorder(recorderConfig, tmcpCeppLogger);
}
