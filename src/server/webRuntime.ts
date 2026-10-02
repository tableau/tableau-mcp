import type { Config } from '../config.js';
import { initializeFeatureGate } from '../features/init.js';
import { getTableauServerInfo } from '../getTableauServerInfo.js';
import { log } from '../logging/logger.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import {
  connectSessionStore,
  disconnectSessionStore,
  initializeSessionStore,
} from '../sessionStore/init.js';

function registerSessionStoreShutdown(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      try {
        await disconnectSessionStore();
        process.exit(0);
      } catch (error) {
        log({
          message: 'Error closing session store during shutdown',
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
  initializeSessionStore();
  await connectSessionStore();
  registerSessionStoreShutdown();

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
