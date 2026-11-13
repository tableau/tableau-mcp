import { closeActivityLog, initializeActivityLog } from '../activityLog/init.js';
import type { Config } from '../config.js';
import { initializeFeatureGate } from '../features/init.js';
import { getTableauServerInfo } from '../getTableauServerInfo.js';
import { log } from '../logging/logger.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { connectKeyValueStore, disconnectKeyValueStore } from '../storage/storageProvider.js';

// Minimal shutdown hook: release the KV store's backend resources and flush the Activity Log
// on termination signals. Intentionally NOT a general graceful-drain (no in-flight request
// draining, no Express close).
const SHUTDOWN_TIMEOUT_MS = 5000;

function registerKeyValueStoreShutdown(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        // A hung backend must not keep the process alive after SIGTERM.
        await Promise.race([
          Promise.all([disconnectKeyValueStore(), closeActivityLog()]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS} ms`)),
              SHUTDOWN_TIMEOUT_MS,
            );
          }),
        ]);
        clearTimeout(timer);
        process.exit(0);
      } catch (error) {
        clearTimeout(timer);
        log({
          message: 'Error closing key-value store or Activity Log during shutdown',
          level: 'error',
          logger: 'shutdown',
          data: error,
        });
        process.exit(1);
      }
    });
  }
}

export async function initializeWebRuntime(
  config: Config,
): Promise<{ serverInfoReady: ReturnType<typeof getTableauServerInfo> }> {
  RestApi.host = config.server;

  initializeFeatureGate();
  await initializeActivityLog();
  await connectKeyValueStore();
  registerKeyValueStoreShutdown();

  const serverInfoReady = getTableauServerInfo(config.server).catch((error) => {
    log({
      message: 'Fatal error initializing server info',
      level: 'error',
      logger: 'startup',
      data: error,
    });
    process.exit(1);
  });

  return { serverInfoReady };
}
