import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import { CeppLogger, CeppSdkRootModule, ICeppEventRecorder } from './sdkTypes.js';
import { SiteEventFileSink } from './siteEventFileSink.js';

export const ACTIVITY_LOG_LOGGER = 'activityLog';

export const serverCeppLogger: CeppLogger = {
  info: (message) => log({ message, level: 'debug', logger: ACTIVITY_LOG_LOGGER }),
  warn: (message) => log({ message, level: 'warning', logger: ACTIVITY_LOG_LOGGER }),
  error: (message) => log({ message, level: 'error', logger: ACTIVITY_LOG_LOGGER }),
};

// Without ACTIVITY_LOG_DIRECTORY, site events go to the debug log (for local runs). This server
// has no tenant events.
export function createActivityLogRecorder(
  config: Config,
  sdk: CeppSdkRootModule,
): ICeppEventRecorder {
  const siteLogger = config.activityLogDirectory
    ? new SiteEventFileSink({
        directory: config.activityLogDirectory,
        diagnostics: serverCeppLogger,
      })
    : serverCeppLogger;

  return new sdk.CeppEventLoggingRecorder({
    config: {
      recordingEnabled: config.activityLogEnabled,
      // mcp_tool_call is an online-only event, and the hosted server runs against Tableau Cloud.
      tableauOnline: true,
      ioErrorSuppressionEnabled: true,
    },
    logger: serverCeppLogger,
    siteLogger,
    tenantLogger: serverCeppLogger,
  });
}
