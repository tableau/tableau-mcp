import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { log } from '../../logging/logger.js';
import { discoveryFileSchema, ExternalApiInstance } from './types.js';

/**
 * Resolve the candidate directories where Desktop writes per-instance `<pid>.json`
 * discovery files, most-likely first. Overridable via `TABLEAU_EXTERNAL_API_DISCOVERY_DIR`.
 *
 * Desktop writes to Qt's AppLocalDataLocation, which is `<root>/<Org>/<AppName>` — and
 * both Org and AppName are "Tableau", so the REAL path carries a DOUBLED segment:
 * live-confirmed on Windows 2026-07-07 (Lauren Jackson's machine):
 * `%LOCALAPPDATA%\Tableau\Tableau\ExternalApi\<pid>.json`. The single-`Tableau` form is
 * kept as a fallback candidate in case a platform/build collapses the org segment.
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

/** Back-compat single-dir resolver: the most likely candidate. */
export function getExternalApiDiscoveryDir(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return getExternalApiDiscoveryDirs(env, platform)[0];
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
  /** Ownership/permission check for a candidate discovery file. Injectable for tests.
   * Defaults to {@link defaultIsDiscoveryFileTrusted}. */
  isFileTrusted?: (path: string) => boolean;
  /** Best-effort check that a pid is actually a Tableau process. Injectable for tests.
   * Defaults to {@link defaultIsProcessTableau}. */
  isProcessTableau?: (pid: number) => boolean;
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
 * POSIX trust gate (W60 P0-1 fix #2): the discovery file must be owned by the current
 * process's uid and not group- or world-writable (mode bits 0o022). This defends
 * against a different-OS-user attacker or a misconfigured world-writable discovery
 * directory — it does NOT defend against a same-uid attacker (see the hardening
 * spec's residual-risk section): P0-1 is DOWNGRADED by this check, not closed.
 *
 * Windows has no equivalent POSIX uid/mode model; `process.getuid` is undefined there
 * and NTFS ACL inspection is a materially bigger lift (no sync stdlib primitive). This
 * check is a deliberate no-op (returns true) on win32 — a known, accepted gap, not an
 * oversight. The one live-confirmed Athena environment referenced anywhere in this
 * codebase (this module's doubled-path comment) IS Windows, so this specific
 * mitigation currently protects zero live-verified environments; it's still worth
 * shipping for macOS/Linux dev and CI, and as the foundation if Windows ACL support is
 * added later.
 */
export function defaultIsDiscoveryFileTrusted(
  path: string,
  platform: NodeJS.Platform = process.platform,
  statFile: (p: string) => { uid: number; mode: number } = statSync,
): boolean {
  if (platform === 'win32') {
    return true;
  }
  try {
    const stat = statFile(path);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (currentUid === undefined) {
      return false; // can't verify ownership — fail closed
    }
    const ownedByUs = stat.uid === currentUid;
    const groupOrWorldWritable = (stat.mode & 0o022) !== 0;
    return ownedByUs && !groupOrWorldWritable;
  } catch {
    return false; // stat failed (raced away, permission denied) — fail closed
  }
}

/**
 * Best-effort check that `pid` is actually a Tableau process, via `ps -o comm=`
 * (macOS/Linux). Not a hard security boundary — a same-uid attacker could rename
 * their own binary — but it raises the cost of the pid-reuse variant of P0-1 (an
 * attacker who pins a pid that is alive but ISN'T Tableau, e.g. an unrelated process
 * the attacker knows will stay alive) and catches accidental pid collisions. Fails
 * CLOSED (returns false) when `ps` errors — an unverifiable pid should not be trusted
 * — but is skipped entirely (returns true) on win32, where there is no cheap sync
 * equivalent; see the hardening spec for why that's an accepted, not fixed, gap.
 */
export function defaultIsProcessTableau(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'win32') {
    return true;
  }
  try {
    const comm = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf-8',
      timeout: 500,
    }).trim();
    return /tableau/i.test(comm);
  } catch {
    return false;
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
  const isFileTrusted = deps.isFileTrusted ?? defaultIsDiscoveryFileTrusted;
  const isProcessTableau = deps.isProcessTableau ?? defaultIsProcessTableau;

  const candidates: Array<{ dir: string; name: string }> = [];
  for (const dir of dirs) {
    try {
      for (const name of readDir(dir)) {
        if (name.endsWith('.json')) candidates.push({ dir, name });
      }
    } catch (error) {
      log({
        message: 'External API discovery directory not readable',
        level: 'debug',
        logger: 'ExternalApiDiscovery',
        data: { dir, error },
      });
    }
  }
  if (candidates.length === 0) {
    return [];
  }

  const scored: Array<{ instance: ExternalApiInstance; sortKey: number }> = [];
  for (const { dir, name } of candidates) {
    const fullPath = join(dir, name);

    if (!isFileTrusted(fullPath)) {
      log({
        message:
          'Skipping untrusted External API discovery file (ownership/permission check failed)',
        level: 'warning',
        logger: 'ExternalApiDiscovery',
        data: { path: fullPath },
      });
      continue;
    }

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
    if (!isPidAlive(file.pid) || !isProcessTableau(file.pid)) {
      log({
        message: 'Skipping External API discovery entry with dead or unverified pid',
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
