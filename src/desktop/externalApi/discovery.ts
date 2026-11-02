import { readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { log } from '../../logging/logger.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { discoveryFileSchema, ExternalApiInstance } from './types.js';

/**
 * Resolve the candidate directories where Desktop writes per-instance `<pid>.json`
 * discovery files, most-likely first. Overridable via `TABLEAU_EXTERNAL_API_DISCOVERY_DIR`.
 *
 * Desktop writes to Qt's AppLocalDataLocation, which is `<root>/<Org>/<AppName>` — and
 * both Org and AppName are "Tableau", so the REAL path carries a DOUBLED segment,
 * live-confirmed on Windows: `%LOCALAPPDATA%\Tableau\Tableau\ExternalApi\<pid>.json`.
 * The single-`Tableau` form is kept as a fallback candidate in case a platform/build
 * collapses the org segment.
 */
export function getExternalApiDiscoveryDirs(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): Array<string> {
  const override = env.TABLEAU_EXTERNAL_API_DISCOVERY_DIR;
  if (override) {
    return [override];
  }

  const root =
    platform === 'win32'
      ? env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : env.XDG_DATA_HOME || join(homedir(), '.local', 'share');

  return [
    join(root, 'Tableau', 'Tableau', 'ExternalApi'), // Qt <Org>/<AppName> — the live-confirmed shape
    join(root, 'Tableau', 'ExternalApi'), // fallback: collapsed org segment
  ];
}

export type DiscoverInstancesDeps = {
  /** Discovery directory to scan. Defaults to {@link getExternalApiDiscoveryDirs}. */
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
  const dirs = deps.discoveryDir ? [deps.discoveryDir] : getExternalApiDiscoveryDirs();
  const readDir = deps.readDir ?? ((d: string): Array<string> => readdirSync(d));
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf-8'));
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;

  const dirReports: Array<{ dir: string; files: number } | { dir: string; error: string }> = [];
  const live: Array<{ pid: number; instanceId: string; startedAt?: string }> = [];
  let deadPidCount = 0;
  let newestDead: { pid: number; instanceId: string; startedAt?: string; ms: number } | undefined;
  let invalidCount = 0;

  // One summary per scan: Desktop leaves stale <pid>.json files behind, so per-file logs flood the log.
  const logScan = (): void =>
    log({
      message: 'External API discovery scan',
      level: 'debug',
      logger: 'ExternalApiDiscovery',
      data: {
        dirs: dirReports,
        live,
        deadPidCount,
        newestDead: newestDead && {
          pid: newestDead.pid,
          instanceId: newestDead.instanceId,
          startedAt: newestDead.startedAt,
        },
        invalidCount,
      },
    });

  const candidates: Array<{ dir: string; name: string }> = [];
  for (const dir of dirs) {
    try {
      let files = 0;
      for (const name of readDir(dir)) {
        if (name.endsWith('.json')) {
          candidates.push({ dir, name });
          files++;
        }
      }
      dirReports.push({ dir, files });
    } catch (error) {
      dirReports.push({
        dir,
        error: (error as NodeJS.ErrnoException | undefined)?.code ?? getExceptionMessage(error),
      });
    }
  }
  if (candidates.length === 0) {
    logScan();
    return [];
  }

  const scored: Array<{ instance: ExternalApiInstance; sortKey: number }> = [];
  for (const { dir, name } of candidates) {
    const fullPath = join(dir, name);

    let raw: unknown;
    try {
      raw = JSON.parse(readFile(fullPath));
    } catch {
      invalidCount++;
      continue;
    }

    const parsed = discoveryFileSchema.safeParse(raw);
    if (!parsed.success) {
      invalidCount++;
      continue;
    }

    const file = parsed.data;
    if (!isPidAlive(file.pid)) {
      deadPidCount++;
      const ms = file.startedAt ? Date.parse(file.startedAt) : NaN;
      if (
        !newestDead ||
        (!Number.isNaN(ms) && (Number.isNaN(newestDead.ms) || ms > newestDead.ms))
      ) {
        newestDead = { pid: file.pid, instanceId: file.instanceId, startedAt: file.startedAt, ms };
      }
      continue;
    }

    live.push({ pid: file.pid, instanceId: file.instanceId, startedAt: file.startedAt });
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

  logScan();

  scored.sort((a, b) => b.sortKey - a.sortKey);
  return scored.map((entry) => entry.instance);
}
