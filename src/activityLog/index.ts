/**
 * ActivityLog / CEPP event scaffolding.
 *
 * Builds ActivityLog events with the (vendored) `@tableau/activitylog-logging-client-ts`
 * SDK and records them through a swappable sink. Everything is gated behind the
 * `ACTIVITY_LOG_ENABLED` config flag (default OFF); the current sink is a stub that logs
 * the built event at debug level and never leaves the process.
 *
 * Copyable pattern for a real tool (see `src/tools/web/projects/listProjects.ts`).
 * Call it AFTER the tool's logAndExecute resolves: sign-in happens inside logAndExecute
 * and populates the identity LUIDs, so reading them earlier returns empty strings for
 * PAT/UAT/direct-trust auth (this mirrors how product telemetry reads them in tool.ts):
 *
 *   const result = await tool.logAndExecute({ ... });
 *   recordActivityLogEvent(extra.config, {
 *     siteLuid: extra.getSiteLuid(),
 *     userLuid: extra.getUserLuid(),
 *     toolName: tool.name,
 *   });
 *   return result;
 */
import { Config } from '../config.js';
import { type ActivityLogEventContext, buildExampleToolInvokedEvent } from './eventBuilder.js';
import {
  ACTIVITY_LOG_LOGGER,
  type ActivityLogRecorder,
  createActivityLogRecorder,
  LoggingActivityLogRecorder,
} from './recorder.js';

export type { ActivityLogEventContext, ActivityLogRecorder };
export {
  ACTIVITY_LOG_LOGGER,
  buildExampleToolInvokedEvent,
  createActivityLogRecorder,
  LoggingActivityLogRecorder,
};

/**
 * Fire-and-forget: build the representative ActivityLog event from tool context and
 * record it. No-ops (without building) when `ACTIVITY_LOG_ENABLED` is off, and never
 * throws — recording must not affect a tool call's result.
 */
export function recordActivityLogEvent(config: Config, ctx: ActivityLogEventContext): void {
  try {
    if (!config.activityLogEnabled) {
      return;
    }
    const recorder = createActivityLogRecorder(config);
    recorder.record(buildExampleToolInvokedEvent(ctx));
  } catch {
    // Swallow: an ActivityLog failure must never break the tool it instruments.
    // The recorder already suppresses I/O errors; this guards event-build errors too.
  }
}
