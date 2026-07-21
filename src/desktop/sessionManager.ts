import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import { log } from '../logging/logger.js';
import { discoverInstances } from './externalApi/discovery.js';
import { ExternalApiToolExecutor } from './externalApi/externalApiToolExecutor.js';

export type DesktopConnection = {
  sessionId: string;
  executor: ExternalApiToolExecutor;
  lastAccess: number;
};

export const EXTERNAL_API_UNAVAILABLE_MESSAGE =
  'This Tableau Desktop build does not serve the External Client API — update Desktop.';

export class ExternalClientApiUnavailableError extends Error {
  constructor(sessionId: string | number) {
    super(`${EXTERNAL_API_UNAVAILABLE_MESSAGE} Requested session: ${sessionId}.`);
    this.name = 'ExternalClientApiUnavailableError';
  }
}

export class SessionManager {
  private readonly sessions: Map<string, DesktopConnection> = new Map();

  async getExecutor(sessionId: string): Promise<ExternalApiToolExecutor> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      const sessionIdResult = parseSessionId(sessionId);
      if (sessionIdResult.isErr()) {
        throw new Error(`Invalid session ID: ${sessionId}. Expected numeric Tableau Desktop PID.`);
      }

      const pid = sessionIdResult.value;
      const config = getDesktopConfig();
      const executor = new ExternalApiToolExecutor({
        pid,
        discover: () => discoverInstances({ discoveryDir: config.externalApiDiscoveryDir }),
      });
      await executor.start();
      if (!executor.isAvailable()) {
        throw new ExternalClientApiUnavailableError(sessionId);
      }

      session = {
        sessionId,
        executor,
        lastAccess: Date.now(),
      };

      this.sessions.set(sessionId, session);
      log({
        message: 'Session created',
        level: 'info',
        logger: 'SessionManager',
        data: {
          sessionId,
          pid,
          transport: 'external-client-api',
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
