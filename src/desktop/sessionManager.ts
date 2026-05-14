import { log } from '../logging/logger';
import { DesktopDiscoverer } from './desktopDiscoverer';
import { DesktopInstance } from './desktopInstance';
import { LocalExecutor } from './toolExecutor/localToolExecutor';
import { ToolExecutor } from './toolExecutor/toolExecutor';

export type DesktopConnection = {
  sessionId: string;
  executor: ToolExecutor;
  lastAccess: number;
  desktopInstance: DesktopInstance;
};

export class SessionManager {
  private readonly sessions: Map<string, DesktopConnection> = new Map();

  async getExecutor(sessionId: string): Promise<ToolExecutor> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      const pid = parseInt(sessionId);
      if (isNaN(pid)) {
        throw new Error(`Invalid session ID for local mode: ${sessionId}. Expected numeric PID.`);
      }

      const desktopDiscoverer = new DesktopDiscoverer();
      const desktopInstance = desktopDiscoverer.getInstance(pid);
      const executor = new LocalExecutor({
        agentApiBase: `http://127.0.0.1:${desktopInstance.port}/api/v1`,
        authToken: desktopInstance.secret,
      });
      await executor.start();

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
          pid: desktopInstance.pid,
          port: desktopInstance.port,
        },
      });
    }

    session.lastAccess = Date.now();
    return session.executor;
  }
}
