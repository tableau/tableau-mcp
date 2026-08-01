/**
 * ActivityLog / CEPP event scaffolding.
 *
 * Builds ActivityLog events with the real `@tableau/activitylog-logging-client-ts` SDK
 * and records them through the SDK's `CeppEventLoggingRecorder`. Everything is gated
 * behind the `ACTIVITY_LOG_ENABLED` config flag (default OFF); the recorder's sink is
 * routed to the TMCP logger at debug level and never leaves the process (TMCP has no CEPP
 * endpoint yet).
 *
 * The SDK is an internal, Nexus-only package and is NOT a declared dependency of this
 * public repo, so it's loaded at runtime via a dynamic `import()`. Recording therefore
 * only activates where an internal/hosted deployment has installed the SDK; external
 * installs and public CI don't have it, and recording silently no-ops there.
 *
 * Copyable pattern for a real tool (see `src/tools/web/projects/listProjects.ts`). Call
 * it AFTER the tool's logAndExecute resolves — sign-in happens inside logAndExecute and
 * populates the identity LUIDs, so a real event that reads them must be built afterwards
 * (this POC event uses static values, but the placement models the real pattern):
 *
 *   const result = await tool.logAndExecute({ ... });
 *   void recordActivityLogEvent(extra.config);
 *   return result;
 */
import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { buildActivityLogSettingsChangeEvent } from './eventBuilder.js';
import { ACTIVITY_LOG_LOGGER, createActivityLogRecorder } from './recorder.js';

export { ACTIVITY_LOG_LOGGER, buildActivityLogSettingsChangeEvent, createActivityLogRecorder };

function logSdkUnavailable(): void {
  log({
    message:
      'ActivityLog is enabled (ACTIVITY_LOG_ENABLED=true) but the CEPP SDK could not be ' +
      'loaded, so recording is a no-op. Install @tableau/activitylog-logging-client-ts (from ' +
      'the internal registry) to enable recording.',
    level: 'debug',
    logger: ACTIVITY_LOG_LOGGER,
  });
}

/**
 * Fire-and-forget: build the POC ActivityLog event and record it. No-ops (without loading
 * the SDK) when `ACTIVITY_LOG_ENABLED` is off; no-ops when the SDK isn't installed — leaving
 * a debug breadcrumb so an enabled-but-broken deployment is discoverable the moment debug
 * logging is turned on; and never throws or rejects — recording must not affect a tool
 * call's result. Callers can safely `void` the returned promise.
 */
export async function recordActivityLogEvent(config: Config): Promise<void> {
  try {
    if (!config.activityLogEnabled) {
      return;
    }
    const recorder = await createActivityLogRecorder(config);
    if (!recorder) {
      logSdkUnavailable();
      return;
    }
    const event = await buildActivityLogSettingsChangeEvent();
    if (!event) {
      logSdkUnavailable();
      return;
    }
    recorder.record(event);
  } catch (error) {
    // Swallow: an ActivityLog failure must never break the tool it instruments. The SDK
    // recorder already suppresses I/O errors; this guards load/build errors too. Leave a
    // debug trace so the failure is diagnosable rather than invisible.
    log({
      message: `ActivityLog recording failed and was suppressed: ${getExceptionMessage(error)}`,
      level: 'debug',
      logger: ACTIVITY_LOG_LOGGER,
    });
  }
}
