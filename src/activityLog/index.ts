/**
 * Activity Log (CEPP) recording of `mcp_tool_call` events, through the internal
 * `@tableau/activitylog-logging-client-ts` SDK. Records only when `ACTIVITY_LOG_ENABLED=true` and
 * the SDK is installed, which in practice means the hosted deployment, where each record is a
 * line of the site event file in `ACTIVITY_LOG_DIRECTORY` that the log shipper forwards.
 */
import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ActivityLogObject, buildMcpToolCallEvent, McpToolCallDetails } from './mcpToolCall.js';
import { ACTIVITY_LOG_LOGGER, createActivityLogRecorder } from './recorder.js';
import { loadCeppSdk } from './sdk.js';
import { CeppSdkEventsModule, ICeppEventRecorder } from './sdkTypes.js';

export type { ActivityLogObject, McpToolCallDetails };

type ActivityLog = {
  events: CeppSdkEventsModule;
  recorder: ICeppEventRecorder;
};

// Set up on the first recorded call. It reads only environment settings, which are the same for
// every request.
let activityLog: Promise<ActivityLog | null> | undefined;

async function setUpActivityLog(config: Config): Promise<ActivityLog | null> {
  const sdk = await loadCeppSdk();
  if (!sdk) {
    log({
      message:
        'ACTIVITY_LOG_ENABLED is true but @tableau/activitylog-logging-client-ts is not ' +
        'installed, so Activity Log events are not recorded.',
      level: 'warning',
      logger: ACTIVITY_LOG_LOGGER,
    });
    return null;
  }

  if (typeof sdk.events.McpToolCall?.builder !== 'function') {
    log({
      message:
        'The installed @tableau/activitylog-logging-client-ts has no McpToolCall event (it needs ' +
        '9.87.0 or later), so Activity Log events are not recorded.',
      level: 'error',
      logger: ACTIVITY_LOG_LOGGER,
    });
    return null;
  }

  if (!config.activityLogDirectory) {
    log({
      message:
        'ACTIVITY_LOG_DIRECTORY is not set, so Activity Log events go to the debug log and are ' +
        'not shipped.',
      level: 'warning',
      logger: ACTIVITY_LOG_LOGGER,
    });
  }

  try {
    return { events: sdk.events, recorder: createActivityLogRecorder(config, sdk.root) };
  } catch (error) {
    log({
      message: `Activity Log could not be set up, so events are not recorded: ${getExceptionMessage(error)}`,
      level: 'error',
      logger: ACTIVITY_LOG_LOGGER,
    });
    return null;
  }
}

/**
 * Records an `mcp_tool_call` event for a finished tool call. Never throws or rejects, so callers
 * can `void` it: recording must not change a tool call's result.
 */
export async function recordMcpToolCall(
  config: Config,
  details: McpToolCallDetails,
): Promise<void> {
  if (!config.activityLogEnabled) {
    return;
  }

  try {
    activityLog ??= setUpActivityLog(config);
    const setUp = await activityLog;
    if (!setUp) {
      return;
    }

    const event = buildMcpToolCallEvent(setUp.events, details);
    if (!event) {
      // Expected when sign-in fails before the LUIDs are known; a LUID that is present but
      // malformed means events are being lost.
      const missing = !details.siteLuid || !details.userLuid;
      log({
        message: `Activity Log event skipped for ${details.toolName}: the call has ${missing ? 'no' : 'an invalid'} site or user LUID`,
        level: missing ? 'debug' : 'warning',
        logger: ACTIVITY_LOG_LOGGER,
      });
      return;
    }

    setUp.recorder.record(event);
  } catch (error) {
    log({
      message: `Activity Log recording failed for ${details.toolName}: ${getExceptionMessage(error)}`,
      level: 'warning',
      logger: ACTIVITY_LOG_LOGGER,
    });
  }
}

/** For tests: forget the set-up recorder so the next call sets up again. */
export function resetActivityLog(): void {
  activityLog = undefined;
}
