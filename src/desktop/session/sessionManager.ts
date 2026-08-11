import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../config.desktop.js';
import { log } from '../../logging/logger.js';
import { currentEpisodeId, emitEpisodeEvent } from '../episode-events.js';
import { discoverInstances } from '../externalApi/discovery.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { parseSessionPid } from './parseSessionPid.js';
import { CACHED_XML_WARNING, noInstanceFoundMessage } from './unreachableInstance.js';

export type DesktopConnection = {
  sessionId: string;
  executor: ExternalApiToolExecutor;
  lastAccess: number;
};

export const EXTERNAL_API_UNAVAILABLE_MESSAGE =
  'This Tableau Desktop build does not serve the External Client API — update Desktop.';

export const PINNED_DESKTOP_UNREACHABLE_MESSAGE =
  'The pinned Tableau Desktop is no longer reachable — it was closed or restarted. Relaunch the agent from Tableau Desktop to reconnect.';

export type DesktopUnavailableReason = 'pinned-unreachable' | 'stale-session' | 'no-api';

export class ExternalClientApiUnavailableError extends Error {
  constructor(sessionId: string | number, reason: DesktopUnavailableReason = 'no-api') {
    super(ExternalClientApiUnavailableError.messageFor(sessionId, reason));
    this.name = 'ExternalClientApiUnavailableError';
  }

  private static messageFor(sessionId: string | number, reason: DesktopUnavailableReason): string {
    switch (reason) {
      // list-instances IS registered when pinned (server.desktop.test.ts asserts it), so
      // this message withholds it on purpose: the pinned Desktop is the one the user
      // launched from, and retargeting a dead pin at whatever else is open would apply
      // their work to a stranger's workbook. Relaunching is the only safe reconnect.
      case 'pinned-unreachable':
        return `${PINNED_DESKTOP_UNREACHABLE_MESSAGE} Pinned PID: ${sessionId}. ${CACHED_XML_WARNING}`;
      case 'stale-session':
        return noInstanceFoundMessage(sessionId);
      case 'no-api':
        return `${EXTERNAL_API_UNAVAILABLE_MESSAGE} Requested session: ${sessionId}.`;
    }
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
      const discover = (): ReturnType<typeof discoverInstances> =>
        discoverInstances({ discoveryDir: config.externalApiDiscoveryDir });
      const executor = new ExternalApiToolExecutor({
        pid,
        discover,
        clientOptions: { timeoutMs: config.desktopCallTimeoutMs },
        onRpc: async (event) => {
          await emitEpisodeEvent(config, {
            type: 'desktop_rpc',
            session_id: sessionId,
            episode_id: currentEpisodeId(sessionId),
            operation: event.operation,
            duration_ms: event.durationMs,
            transport_success: event.transportSuccess,
            rescan_count: event.rescanCount,
          });
        },
      });
      await executor.start();
      if (!executor.isAvailable()) {
        throw new ExternalClientApiUnavailableError(
          sessionId,
          resolveUnavailableReason(sessionId, config.desktopSessionId, discover()),
        );
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

function resolveUnavailableReason(
  sessionId: string,
  pinnedSessionId: string | undefined,
  runningInstances: ReturnType<typeof discoverInstances>,
): DesktopUnavailableReason {
  if (pinnedSessionId === sessionId) {
    return 'pinned-unreachable';
  }
  const others = runningInstances.filter((instance) => String(instance.pid) !== sessionId);
  return others.length > 0 ? 'stale-session' : 'no-api';
}

function parseSessionId(sessionId: string): Result<number, void> {
  const pid = parseSessionPid(sessionId);
  return pid === undefined ? Err.EMPTY : Ok(pid);
}
