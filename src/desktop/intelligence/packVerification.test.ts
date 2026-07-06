import { describe, expect, it } from 'vitest';

import { canonicalizePackManifest } from './contentPack.js';
import { buildCachedPack, fakeVerifier, TEST_ENGINE } from './packFixtures.js';
import {
  checkEngineCompat,
  checkPackFormatCompat,
  checkSchemaCompat,
  unconfiguredVerifier,
  verifyPack,
  verifyResourceHashes,
} from './packVerification.js';

describe('packVerification/SignatureVerifier', () => {
  it('fakeVerifier accepts a matching signature and rejects a mismatch', () => {
    const cached = buildCachedPack();
    const canonical = canonicalizePackManifest(cached.signedManifest.manifest);
    expect(
      fakeVerifier
        .verify({
          payload: canonical,
          signature: cached.signedManifest.signature,
          algorithm: cached.signedManifest.signature_algorithm,
        })
        .isOk(),
    ).toBe(true);
    expect(
      fakeVerifier
        .verify({ payload: canonical, signature: 'wrong', algorithm: fakeVerifier.algorithm })
        .isErr(),
    ).toBe(true);
  });

  it('unconfiguredVerifier rejects every signature (no scheme chosen yet)', () => {
    const r = unconfiguredVerifier.verify({ payload: 'x', signature: 'y', algorithm: 'z' });
    expect(r.isErr()).toBe(true);
  });
});

describe('packVerification/verifyResourceHashes', () => {
  it('passes when every declared sha256 matches the bytes', () => {
    const cached = buildCachedPack();
    expect(verifyResourceHashes(cached.signedManifest.manifest, cached.resources).isOk()).toBe(
      true,
    );
  });

  it('fails when a resource is missing from the bytes map', () => {
    const cached = buildCachedPack();
    const resources = { ...cached.resources };
    delete resources[cached.signedManifest.manifest.resources[0].path];
    expect(verifyResourceHashes(cached.signedManifest.manifest, resources).isErr()).toBe(true);
  });

  it('fails when a resource content was tampered', () => {
    const cached = buildCachedPack();
    const resources = { ...cached.resources };
    resources[cached.signedManifest.manifest.resources[0].path] = 'tampered';
    expect(verifyResourceHashes(cached.signedManifest.manifest, resources).isErr()).toBe(true);
  });
});

describe('packVerification/compat gates', () => {
  it('schema gate accepts equal-or-older and rejects newer', () => {
    expect(checkSchemaCompat('1', TEST_ENGINE).isOk()).toBe(true);
    expect(checkSchemaCompat('0', TEST_ENGINE).isOk()).toBe(true);
    const r = checkSchemaCompat('2', TEST_ENGINE);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().reason).toBe('schema-too-new');
  });

  it('pack-format gate rejects a newer envelope', () => {
    expect(checkPackFormatCompat('1', TEST_ENGINE).isOk()).toBe(true);
    expect(checkPackFormatCompat('2', TEST_ENGINE).unwrapErr().reason).toBe('pack-format-too-new');
  });

  it('engine gate rejects a pack requiring a newer engine than we are', () => {
    expect(checkEngineCompat({ server_min: '2.11.0', node: '>=22' }, TEST_ENGINE).isOk()).toBe(
      true,
    );
    expect(checkEngineCompat({ server_min: '2.10.0', node: '>=22' }, TEST_ENGINE).isOk()).toBe(
      true,
    );
    const r = checkEngineCompat({ server_min: '3.0.0', node: '>=22' }, TEST_ENGINE);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().reason).toBe('incompatible-engine');
  });
});

describe('packVerification/verifyPack — the full funnel', () => {
  it('accepts a well-formed, correctly-signed, hash-matching pack', () => {
    const cached = buildCachedPack();
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.isOk()).toBe(true);
    expect(r.unwrap().fetchedAt instanceof Date).toBe(true);
  });

  it('rejects a tampered resource (wrong bytes) as tampered', () => {
    const cached = buildCachedPack();
    cached.resources[cached.signedManifest.manifest.resources[0].path] = 'tampered';
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().reason).toBe('tampered');
  });

  it('rejects a pack with a newer schema_version, never partially reading it', () => {
    const cached = buildCachedPack({ manifestOverrides: { schema_version: '2' } });
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.unwrapErr().reason).toBe('schema-too-new');
  });

  it('rejects a bad signature', () => {
    const cached = buildCachedPack({ signatureOverride: 'not-the-real-signature' });
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.unwrapErr().reason).toBe('bad-signature');
  });

  it('rejects an engine-incompatible pack', () => {
    const cached = buildCachedPack({
      manifestOverrides: { engine_compat: { server_min: '9.9.9', node: '>=22' } },
    });
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.unwrapErr().reason).toBe('incompatible-engine');
  });

  it('rejects a malformed manifest as malformed (before any crypto)', () => {
    const cached = buildCachedPack();
    (cached.signedManifest.manifest as { schema_version: string }).schema_version = 'x';
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.unwrapErr().reason).toBe('malformed');
  });

  it('rejects an unparseable fetched_at timestamp as malformed', () => {
    const cached = buildCachedPack({ fetched_at: 'not-a-date' });
    const r = verifyPack(cached, { verifier: fakeVerifier, engine: TEST_ENGINE });
    expect(r.unwrapErr().reason).toBe('malformed');
  });
});
