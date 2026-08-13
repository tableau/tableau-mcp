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
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { log } from '../../logging/logger.js';
import { discoverInstances } from '../externalApi/discovery.js';
import { ExternalApiInstance } from '../externalApi/types.js';
import { parseSessionPid } from '../session/parseSessionPid.js';

export interface InstanceFingerprint {
  pid: number;
  /** Per-launch id from the External Client API discovery file; changes on Desktop restart. */
  instanceId: string;
}

export type CacheArtifactKind = 'worksheet' | 'workbook' | 'dashboard' | 'storyboard';

export interface CacheSidecarMeta extends InstanceFingerprint {
  session_id: string;
  created_at: string;
  source_sha256?: string;
}

export interface CheckSidecarResult {
  ok: boolean;
  message?: string;
  sourceHash?: string;
}

/** Resolves the live fingerprint for a session id. Injectable so tests need no discovery dir. */
export type FingerprintResolver = (sessionId: string) => InstanceFingerprint | undefined;

const READ_TOOL_BY_KIND: Record<CacheArtifactKind, string> = {
  worksheet: 'get-worksheet-xml',
  workbook: 'get-workbook-xml',
  dashboard: 'get-dashboard-xml',
  storyboard: 'get-storyboard-xml',
};

export function sidecarPath(cacheFile: string): string {
  return `${cacheFile}.meta.json`;
}

export function fingerprintFromInstance(instance: ExternalApiInstance): InstanceFingerprint {
  return { pid: instance.pid, instanceId: instance.instanceId };
}

/**
 * Default resolver: scan the External Client API discovery files and match the session
 * pid. Returns undefined for a non-numeric session or a pid with no live discovery entry —
 * callers then proceed rather than block blind.
 */
export function defaultFingerprintResolver(sessionId: string): InstanceFingerprint | undefined {
  const pid = parseSessionPid(sessionId);
  if (pid === undefined) return undefined;
  const instance = discoverInstances().find((candidate) => candidate.pid === pid);
  return instance ? fingerprintFromInstance(instance) : undefined;
}

export function sourceSha256(xml: string): string {
  return createHash('sha256').update(xml).digest('hex');
}

export function writeSidecar(
  cacheFile: string,
  sessionId: string,
  resolve?: FingerprintResolver,
): void;
export function writeSidecar(
  cacheFile: string,
  sessionId: string,
  sourceHash?: string,
  resolve?: FingerprintResolver,
): void;
export function writeSidecar(
  cacheFile: string,
  sessionId: string,
  sourceHashOrResolve?: string | FingerprintResolver,
  resolve: FingerprintResolver = defaultFingerprintResolver,
): void {
  const sourceHash = typeof sourceHashOrResolve === 'string' ? sourceHashOrResolve : undefined;
  if (typeof sourceHashOrResolve === 'function') resolve = sourceHashOrResolve;
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
    ...(sourceHash === undefined ? {} : { source_sha256: sourceHash }),
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

/** Restamp an edited cache file without losing the live-source baseline it was read from. */
export function restampSidecarAfterEdit(
  cacheFile: string,
  sessionId: string,
  resolve: FingerprintResolver = defaultFingerprintResolver,
): void {
  writeSidecar(cacheFile, sessionId, readSourceHash(sidecarPath(cacheFile)), resolve);
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

  if (typeof meta.instanceId !== 'string' || typeof meta.pid !== 'number') {
    // Sidecar predates the External Client API fingerprint (agent-manifest era). Same
    // policy as pre-sidecar caches: warn and proceed rather than refuse on missing data.
    log({
      message: 'cache sidecar has a legacy fingerprint — proceeding',
      level: 'warning',
      logger: 'cacheFingerprint',
      data: { file: cacheFile, sidecar: metaFile, sessionId, kind },
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

  if (sameFingerprint(meta, current)) {
    const sourceHash = validSourceHash(meta.source_sha256) ? meta.source_sha256 : undefined;
    return sourceHash === undefined ? { ok: true } : { ok: true, sourceHash };
  }

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
  return a.pid === b.pid && a.instanceId === b.instanceId;
}

function readSourceHash(metaFile: string): string | undefined {
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf-8')) as Partial<CacheSidecarMeta>;
    return validSourceHash(meta.source_sha256) ? meta.source_sha256 : undefined;
  } catch {
    return undefined;
  }
}

function validSourceHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function formatFingerprint(fingerprint: InstanceFingerprint): string {
  return `pid=${fingerprint.pid}, instanceId=${fingerprint.instanceId}`;
}
