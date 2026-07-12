import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import { log } from '../logging/logger.js';
import { DesktopDiscoverer } from './desktopDiscoverer.js';
import { DesktopInstance } from './desktopInstance.js';
import { discoverInstances } from './externalApi/discovery.js';
import { ExternalApiToolExecutor } from './externalApi/externalApiToolExecutor.js';
import { LocalExecutor } from './toolExecutor/localToolExecutor.js';
import { ToolExecutor } from './toolExecutor/toolExecutor.js';

export type DesktopConnection = {
  sessionId: string;
  executor: ToolExecutor;
  lastAccess: number;
  desktopInstance?: DesktopInstance;
};

export class SessionManager {
  private readonly sessions: Map<string, DesktopConnection> = new Map();

  async getExecutor(sessionId: string): Promise<ToolExecutor> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      const sessionIdResult = parseSessionId(sessionId);
      if (sessionIdResult.isErr()) {
        throw new Error(`Invalid session ID for local mode: ${sessionId}. Expected numeric PID.`);
      }

      const pid = sessionIdResult.value;
      const config = getDesktopConfig();

      let executor: ToolExecutor;
      let desktopInstance: DesktopInstance | undefined;

      if (config.externalApiEnabled) {
        // External Client API (Athena V0) transport — flag-gated; default is unchanged.
        executor = new ExternalApiToolExecutor({
          pid,
          discover: () => discoverInstances({ discoveryDir: config.externalApiDiscoveryDir }),
        });
        await executor.start();
      } else {
        const desktopDiscoverer = new DesktopDiscoverer();
        desktopInstance = desktopDiscoverer.getInstance(pid);
        executor = new LocalExecutor({
          agentApiBase: `http://127.0.0.1:${desktopInstance.port}/api/v1`,
          authToken: desktopInstance.secret,
        });
        await executor.start();
      }

      session = {
        sessionId,
        executor,
        lastAccess: Date.now(),
        desktopInstance,
      };

      this.sessions.set(sessionId, session);
      log({
        message: 'Session created',
        level: 'info',
        logger: 'SessionManager',
        data: {
          sessionId,
          pid,
          port: desktopInstance?.port,
          transport: config.externalApiEnabled ? 'external-client-api' : 'agent-api',
        },
      });
    }

    session.lastAccess = Date.now();
    return session.executor;
  }
}

function parseSessionId(sessionId: string): Result<number, void> {
  if (!/^\d+$/.test(sessionId)) {
    return Err.EMPTY;
  }

  const pid = parseInt(sessionId, 10);
  if (isNaN(pid)) {
    return Err.EMPTY;
  }

  return Ok(pid);
}
