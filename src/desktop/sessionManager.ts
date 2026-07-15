import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import { log } from '../logging/logger.js';
import { DesktopDiscoverer, staleSessionRecoveryMessage } from './desktopDiscoverer.js';
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

/**
 * Thrown when a cached session's Desktop instance no longer matches the live manifest
 * (Desktop quit/restarted, so a new process reused — or shifted — the pid/port). The
 * message is agent-actionable: re-list instances, retry with the current session id,
 * re-read stale caches (W9).
 */
export class SessionStaleError extends Error {
  constructor(sessionId: string | number) {
    super(staleSessionRecoveryMessage(sessionId));
    this.name = 'SessionStaleError';
  }
}

export class SessionManager {
  private readonly sessions: Map<string, DesktopConnection> = new Map();
  private injectedDiscoverer?: DesktopDiscoverer;
  private lazyDiscoverer?: DesktopDiscoverer;

  constructor({ discoverer }: { discoverer?: DesktopDiscoverer } = {}) {
    this.injectedDiscoverer = discoverer;
  }

  /**
   * The manifest reader, constructed lazily. Constructing it eagerly would consult
   * discovery machinery even for an explicit-session tool call that never needs it, so
   * it is built only on first real use (session create or the freshness gate).
   */
  private get discoverer(): DesktopDiscoverer {
    return (this.injectedDiscoverer ??= this.lazyDiscoverer ??= new DesktopDiscoverer());
  }

  /** The Desktop instance a cached local session is pinned to (for cache fingerprinting). */
  getDesktopInstance(sessionId: string): DesktopInstance | undefined {
    return this.sessions.get(sessionId)?.desktopInstance;
  }

  async getExecutor(sessionId: string): Promise<ToolExecutor> {
    let session = this.sessions.get(sessionId);

    // A cached executor can outlive its Desktop process: quit/restart replaces the
    // manifest entry but the cached DesktopConnection lingers. Before handing the
    // executor out, verify the cached instance still matches the live manifest — a
    // cheap manifest read, no HTTP — and evict + throw actionably on mismatch (W9).
    // Skipped in external-API mode (no cached DesktopInstance to compare against).
    if (session && session.desktopInstance && !getDesktopConfig().externalApiEnabled) {
      this.ensureCachedLocalSessionFresh(sessionId, session);
      session = this.sessions.get(sessionId);
    }

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
        desktopInstance = this.discoverer.getInstance(pid);
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

  /**
   * Verify a cached local session's Desktop instance still matches the live manifest.
   * A restarted Desktop keeps the same pid rarely but almost always shifts port and
   * always changes start_time, so a port/start_time mismatch (or a pid gone from the
   * manifest) means the cached executor points at a dead or different process. Evict
   * and throw SessionStaleError on mismatch. A manifest with no matching pid also
   * evicts. Never mutates state when the cached instance is still current.
   */
  private ensureCachedLocalSessionFresh(sessionId: string, session: DesktopConnection): void {
    const cached = session.desktopInstance;
    if (!cached) return;

    const current = this.discoverer.getInstances().get(cached.pid);
    if (!current || current.port !== cached.port || current.start_time !== cached.start_time) {
      this.evictStaleSession(sessionId, session, current);
    }
  }

  private evictStaleSession(
    sessionId: string,
    session: DesktopConnection,
    current?: DesktopInstance,
  ): never {
    try {
      session.executor.stop();
    } catch (error) {
      log({
        message: 'Failed to stop stale session executor',
        level: 'warning',
        logger: 'SessionManager',
        data: { sessionId, error: String(error) },
      });
    }
    this.sessions.delete(sessionId);
    log({
      message: 'Session stale — evicted',
      level: 'warning',
      logger: 'SessionManager',
      data: {
        sessionId,
        cached: session.desktopInstance
          ? {
              pid: session.desktopInstance.pid,
              port: session.desktopInstance.port,
              start_time: session.desktopInstance.start_time,
            }
          : null,
        current: current
          ? { pid: current.pid, port: current.port, start_time: current.start_time }
          : null,
      },
    });
    throw new SessionStaleError(sessionId);
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
