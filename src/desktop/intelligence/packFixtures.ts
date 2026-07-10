// src/desktop/intelligence/packFixtures.ts
//
// Test fixtures for the content-pack skeleton (imported only by *.test.ts — never by
// production code, so never bundled). Provides:
//   - `fakeVerifier`: the TEST FAKE for the injectable SignatureVerifier (the real
//     signing scheme is an OPEN question — see docs/authoring-content-pack.md §7).
//   - `buildCachedPack(...)`: assembles a signed, hash-correct CachedPack from REAL
//     bundled resources so a "valid pack accepted" test serves genuine content.
//   - `TEST_ENGINE`: an EngineInfo matching the bundled snapshot.

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Err, Ok } from 'ts-results-es';

import { canonicalizePackManifest, type PackManifest } from './contentPack.js';
import type { CachedPack, EngineInfo, SignatureVerifier } from './packVerification.js';

const FAKE_KEY = 'FAKE-TEST-KEY-not-a-real-secret';
export const FAKE_ALGORITHM = 'fake-hmac-sha256';

function fakeSign(canonical: string): string {
  return createHash('sha256').update(`${FAKE_KEY}|${canonical}`).digest('hex');
}

/** Test fake verifier: accepts only signatures produced by `fakeSign` under FAKE_ALGORITHM. */
export const fakeVerifier: SignatureVerifier = {
  algorithm: FAKE_ALGORITHM,
  verify({ payload, signature, algorithm }) {
    if (algorithm !== FAKE_ALGORITHM) {
      return new Err(`unsupported algorithm '${algorithm}'`);
    }
    if (fakeSign(payload) !== signature) {
      return new Err('signature does not match payload');
    }
    return new Ok(undefined);
  },
};

/** EngineInfo matching the bundled snapshot (schema 1, pack-format 1, server 2.11.0). */
export const TEST_ENGINE: EngineInfo = {
  version: '2.11.0',
  supportedSchemaVersion: '1',
  supportedPackFormatVersion: '1',
};

export interface FixtureResource {
  path: string;
  content: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');

function readData(rel: string): FixtureResource {
  return { path: rel, content: fs.readFileSync(path.join(DATA_DIR, rel), 'utf8') };
}

/**
 * Real bundled resources — a normal template (manifest + shipped XML) so a verified
 * pack materializes genuine content and can be compared against the bundled provider.
 */
export const DEFAULT_FIXTURE_RESOURCES: FixtureResource[] = [
  readData('template-manifests/ranking-ordered-bar.manifest.json'),
  readData('data-visualization-templates-xml/ranking-ordered-bar.xml'),
];

/**
 * Assemble a signed, hash-correct CachedPack. Options let a test inject a wrong
 * signature, override manifest fields (e.g. bump schema_version), or set fetched_at.
 * The signature is computed over the FINAL manifest (post-overrides) unless a
 * `signatureOverride` is supplied.
 */
export function buildCachedPack(opts?: {
  resources?: FixtureResource[];
  fetched_at?: string;
  manifestOverrides?: Partial<PackManifest>;
  signatureOverride?: string;
}): CachedPack {
  const resources = opts?.resources ?? DEFAULT_FIXTURE_RESOURCES;
  const resourceEntries = resources.map((r) => ({
    path: r.path,
    sha256: createHash('sha256').update(r.content).digest('hex'),
    bytes: Buffer.byteLength(r.content, 'utf8'),
  }));
  const manifest: PackManifest = {
    pack_format_version: '1',
    content_version: '2.11.0+content.2026-07-06',
    schema_version: '1',
    generated: '2026-07-06',
    engine_compat: { server_min: '2.11.0', node: '>=22.7.5' },
    resources: resourceEntries,
    ...opts?.manifestOverrides,
  };
  const signature = opts?.signatureOverride ?? fakeSign(canonicalizePackManifest(manifest));
  const resourcesRecord: Record<string, string> = {};
  for (const r of resources) {
    resourcesRecord[r.path] = r.content;
  }
  return {
    signedManifest: { manifest, signature, signature_algorithm: FAKE_ALGORITHM },
    resources: resourcesRecord,
    fetched_at: opts?.fetched_at ?? '2026-07-06T00:00:00.000Z',
  };
}
