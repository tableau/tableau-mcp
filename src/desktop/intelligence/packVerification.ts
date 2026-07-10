// src/desktop/intelligence/packVerification.ts
//
// Pure content-pack VERIFICATION (Lane M6 milestone-2 skeleton — NO network I/O).
// Every gate is fail-closed: a pack that fails ANY check is rejected wholesale and
// the caller drops to the fallback ladder (docs/authoring-content-pack.md §4). Nothing
// here is partially applied — verifyPack returns a whole VerifiedPack or a typed
// rejection.
//
// SIGNING SCHEME IS AN OPEN QUESTION (§7): this module defines the injectable
// `SignatureVerifier` interface + a safe default (`unconfiguredVerifier` rejects all)
// but does NOT pick or vendor a crypto scheme. A test fake lives in packFixtures.ts.

import { createHash } from 'crypto';
import { Err, Ok, type Result } from 'ts-results-es';

import {
  canonicalizePackManifest,
  compareVersions,
  type EngineCompat,
  type PackManifest,
  parseSignedPackManifest,
  type SignedPackManifest,
} from './contentPack.js';

/** What the engine (this MCP build) understands — injected so verification is pure/testable. */
export interface EngineInfo {
  /** This build's version, for the engine-compat range. */
  version: string;
  /** Max CONTENT schema_version the engine can read. */
  supportedSchemaVersion: string;
  /** Max pack ENVELOPE format the engine can parse. */
  supportedPackFormatVersion: string;
}

/** Injectable signature verifier. The concrete scheme is an OPEN question (see §7). */
export interface SignatureVerifier {
  /** Identifier of the scheme this verifier implements. */
  readonly algorithm: string;
  /** Verify a detached signature over `payload`. Ok(void) on success, Err(detail) otherwise. */
  verify(input: { payload: string; signature: string; algorithm: string }): Result<void, string>;
}

/**
 * The shipped default until a signing scheme is chosen: rejects EVERY signature.
 * This is deliberately safe — with no verifier configured a remote pack can never
 * verify, so the engine stays on the bundled snapshot (honest, offline-correct).
 */
export const unconfiguredVerifier: SignatureVerifier = {
  algorithm: 'none',
  verify: () =>
    new Err('no signing scheme configured (open question — see docs/authoring-content-pack.md §7)'),
};

/** A pack as held in the cache store: the signed envelope + the raw resource bytes + when fetched. */
export interface CachedPack {
  signedManifest: SignedPackManifest;
  /** Resource path → UTF-8 content bytes (parallel to `manifest.resources`). */
  resources: Record<string, string>;
  /**
   * ISO-8601 timestamp of when the pack was written to cache (for TTL). This is
   * cache-LOCAL metadata that lives OUTSIDE the signed envelope, so the signature does
   * NOT cover it. HONEST LIMITATION: any actor that can write the cache can bump this to
   * re-freshen a stale pack; that hole is unfixable here without a signed server time
   * source (an open question — see docs/authoring-content-pack.md §7). What IS fixed:
   * `evaluateCachedPack` rejects a `fetched_at` dated beyond a small clock skew into the
   * FUTURE as `tampered` (a forged-future stamp cannot claim freshness forever).
   */
  fetched_at: string;
}

/** A pack that passed every §4 gate. */
export interface VerifiedPack {
  manifest: PackManifest;
  resources: Record<string, string>;
  fetchedAt: Date;
}

/** Closed set of reasons a pack is rejected (fail-closed). Maps to RemoteFallbackReason. */
export type PackRejectionReason =
  | 'malformed'
  | 'schema-too-new'
  | 'pack-format-too-new'
  | 'incompatible-engine'
  | 'bad-signature'
  | 'tampered';

export interface PackRejection {
  reason: PackRejectionReason;
  detail: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Content schema gate: reject a pack whose schema is NEWER than the engine understands. */
export function checkSchemaCompat(
  schemaVersion: string,
  engine: EngineInfo,
): Result<void, PackRejection> {
  if (compareVersions(schemaVersion, engine.supportedSchemaVersion) > 0) {
    return new Err({
      reason: 'schema-too-new',
      detail: `pack schema_version ${schemaVersion} > engine max ${engine.supportedSchemaVersion}`,
    });
  }
  return new Ok(undefined);
}

/** Envelope-format gate: reject a pack whose envelope format is NEWER than we can parse. */
export function checkPackFormatCompat(
  packFormatVersion: string,
  engine: EngineInfo,
): Result<void, PackRejection> {
  if (compareVersions(packFormatVersion, engine.supportedPackFormatVersion) > 0) {
    return new Err({
      reason: 'pack-format-too-new',
      detail: `pack_format_version ${packFormatVersion} > engine max ${engine.supportedPackFormatVersion}`,
    });
  }
  return new Ok(undefined);
}

/** Engine-compat gate: reject when this engine is OLDER than the pack's `server_min`. */
export function checkEngineCompat(
  engineCompat: EngineCompat,
  engine: EngineInfo,
): Result<void, PackRejection> {
  if (compareVersions(engine.version, engineCompat.server_min) < 0) {
    return new Err({
      reason: 'incompatible-engine',
      detail: `engine ${engine.version} < pack server_min ${engineCompat.server_min}`,
    });
  }
  return new Ok(undefined);
}

/** Integrity gate: every declared resource must be present and its sha256 must match. */
export function verifyResourceHashes(
  manifest: PackManifest,
  resources: Record<string, string>,
): Result<void, PackRejection> {
  for (const r of manifest.resources) {
    const content = resources[r.path];
    if (content === undefined) {
      return new Err({ reason: 'tampered', detail: `missing resource bytes for ${r.path}` });
    }
    if (sha256Hex(content) !== r.sha256) {
      return new Err({ reason: 'tampered', detail: `sha256 mismatch for ${r.path}` });
    }
  }
  return new Ok(undefined);
}

/**
 * The MANIFEST verification funnel (steps 1–5) — everything provable from the signed
 * envelope ALONE, before any resource bytes are in hand. Order matters (cheapest/
 * structural first, crypto last, NEVER a partial read):
 *   1. parse the signed manifest metadata (malformed)
 *   2. content-schema gate (schema-too-new)
 *   3. pack-format gate (pack-format-too-new)
 *   4. engine-compat gate (incompatible-engine)
 *   5. signature over canonicalize(manifest) (bad-signature)
 *
 * This is the ONE funnel `verifyPack` extends and `refresh()` runs BEFORE fetching a
 * pack's resources: a manifest whose signature does not cover its canonical bytes is
 * never trusted to name (and so drive a fetch of) arbitrary declared resources.
 */
export function verifyPackManifest(
  signedManifest: SignedPackManifest,
  deps: { verifier: SignatureVerifier; engine: EngineInfo },
): Result<PackManifest, PackRejection> {
  const parsed = parseSignedPackManifest(signedManifest);
  if (parsed.isErr()) {
    return new Err({ reason: 'malformed', detail: parsed.error.join('; ') });
  }
  const { manifest, signature, signature_algorithm } = parsed.value;

  const schema = checkSchemaCompat(manifest.schema_version, deps.engine);
  if (schema.isErr()) return new Err(schema.error);

  const format = checkPackFormatCompat(manifest.pack_format_version, deps.engine);
  if (format.isErr()) return new Err(format.error);

  const engineCompat = checkEngineCompat(manifest.engine_compat, deps.engine);
  if (engineCompat.isErr()) return new Err(engineCompat.error);

  const sig = deps.verifier.verify({
    payload: canonicalizePackManifest(manifest),
    signature,
    algorithm: signature_algorithm,
  });
  if (sig.isErr()) return new Err({ reason: 'bad-signature', detail: sig.error });

  return new Ok(manifest);
}

/**
 * The full verification funnel: the manifest funnel (steps 1–5, via `verifyPackManifest`
 * — SINGLE source of gate order) THEN the resource-byte gates that need the fetched
 * content:
 *   6. per-resource sha256 (tampered)
 *   7. fetched_at timestamp parse (malformed)
 * Still fail-closed and never a partial read: any step's Err rejects the whole pack.
 */
export function verifyPack(
  cached: CachedPack,
  deps: { verifier: SignatureVerifier; engine: EngineInfo },
): Result<VerifiedPack, PackRejection> {
  const manifestResult = verifyPackManifest(cached.signedManifest, deps);
  if (manifestResult.isErr()) return new Err(manifestResult.error);
  const manifest = manifestResult.value;

  const hashes = verifyResourceHashes(manifest, cached.resources);
  if (hashes.isErr()) return new Err(hashes.error);

  const fetchedAt = new Date(cached.fetched_at);
  if (Number.isNaN(fetchedAt.getTime())) {
    return new Err({ reason: 'malformed', detail: `invalid fetched_at '${cached.fetched_at}'` });
  }

  return new Ok({ manifest, resources: cached.resources, fetchedAt });
}
