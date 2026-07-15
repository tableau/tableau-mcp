/**
 * Cache-file instance fingerprinting — the cross-instance bleed guard (W9).
 *
 * Cache file names are deterministic and sessionless (workbook-for-parallel-build.xml,
 * worksheet-<name>.xml), so with two Desktops running, instance A's cached XML can be
 * applied to instance B. Cache-writing tools write a `<file>.meta.json` sidecar recording
 * which Desktop instance produced the cache; apply tools that consume a cache file refuse
 * a mismatched fingerprint and tell the agent to re-read in the current session. There is
 * deliberately NO override flag — an agent-passable confirm re-opens the self-confirm
 * hole; the recovery is always "re-read, then apply". Missing/unreadable sidecars warn and
 * proceed (pre-sidecar caches stay valid), and a fingerprint that cannot be resolved never
 * blocks blind.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { log } from '../../../logging/logger.js';
import { DesktopDiscoverer } from '../../desktopDiscoverer.js';
import { DesktopInstance } from '../../desktopInstance.js';

export interface InstanceFingerprint {
  pid: number;
  port: number;
  start_time: string;
}

export type CacheArtifactKind = 'worksheet' | 'workbook' | 'dashboard';

export interface CacheSidecarMeta extends InstanceFingerprint {
  session_id: string;
  created_at: string;
}

export interface CheckSidecarResult {
  ok: boolean;
  message?: string;
}

/** Resolves the live fingerprint for a session id. Injectable so tests need no manifest. */
export type FingerprintResolver = (sessionId: string) => InstanceFingerprint | undefined;

const READ_TOOL_BY_KIND: Record<CacheArtifactKind, string> = {
  worksheet: 'get-worksheet-xml',
  workbook: 'get-workbook-xml',
  dashboard: 'get-dashboard-xml',
};

export function sidecarPath(cacheFile: string): string {
  return `${cacheFile}.meta.json`;
}

export function fingerprintFromInstance(instance: DesktopInstance): InstanceFingerprint {
  return { pid: instance.pid, port: instance.port, start_time: instance.start_time };
}

/**
 * Default resolver: read the live manifest and match the session pid. Returns undefined
 * for a non-numeric session (external-API pids are still numeric) or a pid absent from
 * the manifest — callers then proceed rather than block blind.
 */
export function defaultFingerprintResolver(sessionId: string): InstanceFingerprint | undefined {
  if (!/^\d+$/.test(sessionId)) return undefined;
  const pid = Number.parseInt(sessionId, 10);
  const instance = new DesktopDiscoverer().getInstances().get(pid);
  return instance ? fingerprintFromInstance(instance) : undefined;
}

export function writeSidecar(
  cacheFile: string,
  sessionId: string,
  resolve: FingerprintResolver = defaultFingerprintResolver,
): void {
  const fingerprint = resolve(sessionId);
  if (!fingerprint) {
    log({
      message: 'cache sidecar not written — no instance fingerprint',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, sessionId },
    });
    return;
  }

  const meta: CacheSidecarMeta = {
    session_id: sessionId,
    ...fingerprint,
    created_at: new Date().toISOString(),
  };

  try {
    writeFileSync(sidecarPath(cacheFile), JSON.stringify(meta, null, 2), 'utf-8');
  } catch (error) {
    log({
      message: 'cache sidecar write failed',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, error: String(error) },
    });
  }
}

export function checkSidecar(
  cacheFile: string,
  sessionId: string,
  kind: CacheArtifactKind,
  resolve: FingerprintResolver = defaultFingerprintResolver,
): CheckSidecarResult {
  const metaFile = sidecarPath(cacheFile);
  if (!existsSync(metaFile)) {
    log({
      message: 'cache sidecar missing — proceeding (pre-sidecar cache)',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, sidecar: metaFile, sessionId, kind },
    });
    return { ok: true };
  }

  let meta: CacheSidecarMeta;
  try {
    meta = JSON.parse(readFileSync(metaFile, 'utf-8')) as CacheSidecarMeta;
  } catch (error) {
    log({
      message: 'cache sidecar unreadable — proceeding',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, sidecar: metaFile, error: String(error) },
    });
    return { ok: true };
  }

  const current = resolve(sessionId);
  if (!current) {
    log({
      message: 'cache sidecar current fingerprint unavailable — proceeding',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, sidecar: metaFile, sessionId, kind },
    });
    return { ok: true };
  }

  if (sameFingerprint(meta, current)) return { ok: true };

  const message =
    `Refusing to apply ${kind} cache file from a different Tableau Desktop session: ${cacheFile}\n\n` +
    `Cache file fingerprint: session_id=${meta.session_id}, ${formatFingerprint(meta)}\n` +
    `Current session fingerprint: session_id=${sessionId}, ${formatFingerprint(current)}\n\n` +
    `Re-read the ${kind} in the current session with ${READ_TOOL_BY_KIND[kind]}, edit the newly returned cache file, then retry the apply. Cached XML files from the old session may not match the current workbook.`;

  log({
    message: 'cache fingerprint mismatch',
    level: 'error',
    logger: 'cacheFingerprint',
    data: { file: cacheFile, sidecar: metaFile, sessionId, kind, cached: meta, current },
  });
  return { ok: false, message };
}

function sameFingerprint(a: InstanceFingerprint, b: InstanceFingerprint): boolean {
  return a.pid === b.pid && a.port === b.port && a.start_time === b.start_time;
}

function formatFingerprint(fingerprint: InstanceFingerprint): string {
  return `pid=${fingerprint.pid}, port=${fingerprint.port}, start_time=${fingerprint.start_time}`;
}
