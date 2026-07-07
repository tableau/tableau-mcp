import { readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { log } from '../../logging/logger.js';
import { discoveryFileSchema, ExternalApiInstance } from './types.js';

/**
 * Resolve the platform-correct directory where Desktop writes per-instance
 * `<pid>.json` discovery files. Overridable via `TABLEAU_EXTERNAL_API_DISCOVERY_DIR`.
 *
 * NOTE: the exact sub-path under the OS app-local-data root is a residual risk — the
 * PR evidence only pinned the `ExternalApi/<pid>.json` leaf. `Tableau/ExternalApi` is
 * the best current guess; keep it overridable.
 */
export function getExternalApiDiscoveryDir(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.TABLEAU_EXTERNAL_API_DISCOVERY_DIR;
  if (override) {
    return override;
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'Tableau', 'ExternalApi');
  }

  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Tableau', 'ExternalApi');
  }

  const xdgDataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(xdgDataHome, 'Tableau', 'ExternalApi');
}

export type DiscoverInstancesDeps = {
  /** Discovery directory to scan. Defaults to {@link getExternalApiDiscoveryDir}. */
  discoveryDir?: string;
  /** Directory listing. Injectable for tests. */
  readDir?: (dir: string) => Array<string>;
  /** File reader. Injectable for tests. */
  readFile?: (path: string) => string;
  /** Liveness check for a pid. Injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
};

/** Default pid liveness probe using a no-op signal. */
export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH => no such process (dead). EPERM => process exists but is owned by
    // another user (alive, we just can't signal it).
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Scan the discovery directory, parse + validate `schemaVersion === 1` files, drop
 * entries whose pid is dead, and return live instances sorted newest-first (by
 * `startedAt`). Never throws — unreadable dirs/files yield fewer/zero instances.
 */
export function discoverInstances(deps: DiscoverInstancesDeps = {}): Array<ExternalApiInstance> {
  const dir = deps.discoveryDir ?? getExternalApiDiscoveryDir();
  const readDir = deps.readDir ?? ((d: string): Array<string> => readdirSync(d));
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf-8'));
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;

  let files: Array<string>;
  try {
    files = readDir(dir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    log({
      message: 'External API discovery directory not readable',
      level: 'debug',
      logger: 'ExternalApiDiscovery',
      data: { dir, error },
    });
    return [];
  }

  const scored: Array<{ instance: ExternalApiInstance; sortKey: number }> = [];
  for (const name of files) {
    const fullPath = join(dir, name);

    let raw: unknown;
    try {
      raw = JSON.parse(readFile(fullPath));
    } catch {
      continue;
    }

    const parsed = discoveryFileSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }

    const file = parsed.data;
    if (!isPidAlive(file.pid)) {
      log({
        message: 'Skipping External API discovery entry with dead pid',
        level: 'debug',
        logger: 'ExternalApiDiscovery',
        data: { pid: file.pid, instanceId: file.instanceId },
      });
      continue;
    }

    const startedAtMs = file.startedAt ? Date.parse(file.startedAt) : NaN;
    scored.push({
      instance: {
        baseUrl: file.baseUrl,
        token: file.token,
        pid: file.pid,
        instanceId: file.instanceId,
        apiVersion: file.apiVersion,
      },
      sortKey: Number.isNaN(startedAtMs) ? -Infinity : startedAtMs,
    });
  }

  scored.sort((a, b) => b.sortKey - a.sortKey);
  return scored.map((entry) => entry.instance);
}
