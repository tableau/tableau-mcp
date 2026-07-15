import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import { log } from '../logging/logger.js';
import { DesktopInstance, desktopInstanceMetadataSchema } from './desktopInstance.js';

const manifestSchema = z.object({
  instances: z.array(desktopInstanceMetadataSchema),
});

export type DesktopInstanceManifest = z.infer<typeof manifestSchema>;

/**
 * Agent-actionable recovery text for a stale session (Desktop quit/restarted, or a
 * cache file produced by a different Desktop instance). Shared by SessionManager's
 * freshness gate and the cache-fingerprint bleed guard so both speak the same recovery.
 */
export function staleSessionRecoveryMessage(sessionId: string | number): string {
  return (
    `Session ${sessionId} is stale: that Tableau Desktop process is no longer reachable or was restarted. ` +
    `Call list-instances and retry with the current session id. ` +
    `Cached XML files from the old session may not match the current workbook — re-read before applying.`
  );
}

export class DesktopDiscoverer {
  private readonly isPidAlive: (pid: number) => boolean;

  constructor({ isPidAlive = defaultIsPidAlive }: { isPidAlive?: (pid: number) => boolean } = {}) {
    this.isPidAlive = isPidAlive;
  }

  getInstances(): Map<number, DesktopInstance> {
    const manifestPath = getManifestPath();
    if (!existsSync(manifestPath)) {
      return new Map();
    }

    try {
      const content = readFileSync(manifestPath, 'utf8');
      const manifest = manifestSchema.parse(JSON.parse(content));
      // Desktop appends to the manifest but never prunes, so it accumulates entries for
      // long-dead pids (observed: 119 "instances" with one Desktop running — W60). A stale
      // entry breaks session auto-resolution (never "exactly one") and offers agents dead
      // sessions. Keep only entries whose pid is alive.
      return new Map(
        manifest.instances
          .filter((instance) => this.isPidAlive(instance.pid))
          .map((instance) => [instance.pid, new DesktopInstance(instance)]),
      );
    } catch (error) {
      log({
        message: 'Failed to read manifest',
        level: 'error',
        logger: 'DesktopDiscoverer',
        data: error,
      });
      return new Map();
    }
  }

  getInstance(pid: number): DesktopInstance {
    const instances = this.getInstances();
    const instance = instances.get(pid);

    if (!instance) {
      throw new Error(`No Desktop instance found with PID ${pid}`);
    }

    return instance;
  }
}

/** Liveness probe via a no-op signal. EPERM = alive but not ours; ESRCH = dead. */
function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function getManifestPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'Tableau', 'Desktop', 'agent-manifest.json');
  }

  return join(homedir(), '.tableau', 'agent-manifest.json');
}
