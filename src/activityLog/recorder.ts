import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import {
  CeppEventRecorderConfig,
  CeppLogger,
  CeppSdkRootModule,
  ICeppEventRecorder,
} from './sdkTypes.js';

/** Logger name stamped on every ActivityLog line so operators can grep/route it. */
export const ACTIVITY_LOG_LOGGER = 'activityLog';

/**
 * Root (`.`) specifier of the CEPP SDK. Held in a `const` (not inlined at the import
 * site) so the dynamic `import()` uses a non-literal specifier: TypeScript then treats
 * the module as `any` instead of trying to resolve it at compile time — which it can't,
 * since the SDK is an internal Nexus-only package that isn't a declared dependency of
 * this public repo. esbuild likewise leaves it as a runtime `require`, not a bundle input.
 */
const CEPP_SDK_ROOT_MODULE = '@tableau/activitylog-logging-client-ts';

/**
 * Bridges the SDK's `CeppLogger` to the TMCP logger. The SDK's `CeppEventLoggingRecorder`
 * serializes each record and writes it through `info`; routing that to TMCP's `log()` at
 * debug level keeps ActivityLog output in the same stream as everything else — and, for
 * now, nowhere else: TMCP has no CEPP endpoint yet, so this stub sink never leaves the
 * process. `warn`/`error` carry the SDK's own suppressed-I/O diagnostics.
 */
const tmcpCeppLogger: CeppLogger = {
  info: (message) => log({ message, level: 'debug', logger: ACTIVITY_LOG_LOGGER }),
  warn: (message) => log({ message, level: 'warning', logger: ACTIVITY_LOG_LOGGER }),
  error: (message) => log({ message, level: 'error', logger: ACTIVITY_LOG_LOGGER }),
};

/**
 * Loads the CEPP SDK's root module at runtime, or returns `null` if it isn't installed.
 *
 * The SDK ships only to Salesforce's internal Nexus registry, so it's present only where
 * an internal/hosted deployment installed it as part of its setup. External installs and
 * public CI never have it — there the `import()` rejects and this returns `null`, so
 * ActivityLog recording silently no-ops rather than breaking the server.
 */
async function loadCeppSdkRoot(): Promise<CeppSdkRootModule | null> {
  try {
    return (await import(CEPP_SDK_ROOT_MODULE)) as CeppSdkRootModule;
  } catch {
    return null;
  }
}

/**
 * Builds the ActivityLog recorder from TMCP config using the SDK's own
 * `CeppEventLoggingRecorder`, with its site/tenant loggers routed to the TMCP logger.
 * Returns `null` when the SDK isn't available (see `loadCeppSdkRoot`). `recordingEnabled`
 * is wired to `ACTIVITY_LOG_ENABLED`, so a recorder built while the flag is off is a safe
 * no-op even if a caller forgets to gate first.
 */
export async function createActivityLogRecorder(
  config: Config,
): Promise<ICeppEventRecorder | null> {
  const sdk = await loadCeppSdkRoot();
  if (!sdk) {
    return null;
  }

  const recorderConfig: CeppEventRecorderConfig = {
    recordingEnabled: config.activityLogEnabled,
    // TMCP targets Tableau Cloud; a real wiring would derive this from the server type.
    tableauOnline: true,
    // Recording an ActivityLog event must never surface an I/O failure to a tool call.
    ioErrorSuppressionEnabled: true,
  };

  return new sdk.CeppEventLoggingRecorder({
    config: recorderConfig,
    logger: tmcpCeppLogger,
    siteLogger: tmcpCeppLogger,
    tenantLogger: tmcpCeppLogger,
  });
}
