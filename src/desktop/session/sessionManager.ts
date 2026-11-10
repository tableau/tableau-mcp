import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../config.desktop.js';
import { ArgsValidationError, ServiceUnavailableError } from '../../errors/mcpToolError.js';
import { log } from '../../logging/logger.js';
import { currentEpisodeId, emitEpisodeEvent } from '../episode-events.js';
import { defaultIsPidAlive, discoverInstances } from '../externalApi/discovery.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { buildDesktopUserAgent } from '../externalApi/userAgent.js';
import { parseSessionPid } from './parseSessionPid.js';
import {
  CACHED_XML_WARNING,
  EXTERNAL_API_ACCESS_HOW_TO_FIX,
  noInstanceFoundMessage,
  pinnedDesktopNotAcceptingMessage,
} from './unreachableInstance.js';

export type DesktopConnection = {
  sessionId: string;
  executor: ExternalApiToolExecutor;
};

export const EXTERNAL_API_UNAVAILABLE_MESSAGE = `No Tableau Desktop is accepting agent connections. If Tableau Desktop is open, External API access is probably turned off. ${EXTERNAL_API_ACCESS_HOW_TO_FIX} Older Tableau Desktop builds don't have this setting and need an update.`;

export const PINNED_DESKTOP_UNREACHABLE_MESSAGE =
  'The pinned Tableau Desktop is no longer reachable — it was closed or restarted. Relaunch the agent from Tableau Desktop to reconnect.';

export type DesktopUnavailableReason =
  | 'pinned-unreachable'
  | 'pinned-not-accepting'
  | 'stale-session'
  | 'no-api';

export class ExternalClientApiUnavailableError extends ServiceUnavailableError {
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
      case 'pinned-not-accepting':
        return `${pinnedDesktopNotAcceptingMessage(sessionId)} ${CACHED_XML_WARNING}`;
      case 'stale-session':
        return noInstanceFoundMessage(sessionId);
      case 'no-api':
        return `${EXTERNAL_API_UNAVAILABLE_MESSAGE} Requested session: ${sessionId}.`;
    }
  }
}

export type SessionManagerDeps = {
  /** Liveness probe for the pinned Desktop pid. Injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
};

export class SessionManager {
  private readonly isPidAlive: (pid: number) => boolean;

  constructor(deps: SessionManagerDeps = {}) {
    this.isPidAlive = deps.isPidAlive ?? ((pid) => defaultIsPidAlive(pid));
  }

  private readonly sessions: Map<string, DesktopConnection> = new Map();

  async getExecutor(sessionId: string): Promise<ExternalApiToolExecutor> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      const sessionIdResult = parseSessionId(sessionId);
      if (sessionIdResult.isErr()) {
        throw new ArgsValidationError(
          `Invalid session ID: ${sessionId}. Expected numeric Tableau Desktop PID.`,
        );
      }

      const pid = sessionIdResult.value;
      const config = getDesktopConfig();
      const discover = (): ReturnType<typeof discoverInstances> =>
        discoverInstances({ discoveryDir: config.externalApiDiscoveryDir });
      const executor = new ExternalApiToolExecutor({
        pid,
        discover,
        clientOptions: {
          timeoutMs: config.desktopCallTimeoutMs,
          userAgent: buildDesktopUserAgent(config.userAgentPrefix),
        },
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
          resolveUnavailableReason(sessionId, config.desktopSessionId, discover(), () =>
            this.isPidAlive(pid),
          ),
        );
      }

      session = {
        sessionId,
        executor,
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

    return session.executor;
  }
}

function resolveUnavailableReason(
  sessionId: string,
  pinnedSessionId: string | undefined,
  runningInstances: ReturnType<typeof discoverInstances>,
  isPinnedPidAlive: () => boolean,
): DesktopUnavailableReason {
  if (pinnedSessionId === sessionId) {
    return isPinnedPidAlive() ? 'pinned-not-accepting' : 'pinned-unreachable';
  }
  const others = runningInstances.filter((instance) => String(instance.pid) !== sessionId);
  return others.length > 0 ? 'stale-session' : 'no-api';
}

function parseSessionId(sessionId: string): Result<number, void> {
  const pid = parseSessionPid(sessionId);
  return pid === undefined ? Err.EMPTY : Ok(pid);
}
