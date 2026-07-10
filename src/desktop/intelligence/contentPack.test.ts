import { describe, expect, it } from 'vitest';

import {
  canonicalizePackManifest,
  compareVersions,
  isResourcePathSafe,
  type PackManifest,
  parsePackManifest,
  parseSignedPackManifest,
} from './contentPack.js';

/** A structurally valid pack manifest fixture (deep-cloned per call so tests can mutate). */
function validManifest(): PackManifest {
  return {
    pack_format_version: '1',
    content_version: '2.11.0+content.2026-07-06',
    schema_version: '1',
    generated: '2026-07-06',
    engine_compat: { server_min: '2.11.0', node: '>=22.7.5' },
    resources: [
      {
        path: 'template-manifests/ranking-ordered-bar.manifest.json',
        sha256: 'd1880b8a047d8e169b267e16d0e52a9f1b22a1f1684edf093df30ef230306575',
        bytes: 1186,
      },
      {
        path: 'data-visualization-templates-xml/ranking-ordered-bar.xml',
        sha256: '0f9a70bfdca9171d40022364a94d0ee7fe036dc792f741ab104fc38dc6a28c4e',
        bytes: 2430,
      },
    ],
  };
}

describe('contentPack/compareVersions', () => {
  it('orders numeric dotted versions', () => {
    expect(compareVersions('2.11.0', '2.11.1')).toBe(-1);
    expect(compareVersions('2.12.0', '2.11.9')).toBe(1);
    expect(compareVersions('2.11.0', '2.11.0')).toBe(0);
  });

  it('treats a shorter version as lower only when the shared components tie', () => {
    expect(compareVersions('2.11', '2.11.1')).toBe(-1);
    expect(compareVersions('2.11.0', '2.11')).toBe(0);
    expect(compareVersions('3', '2.11.9')).toBe(1);
  });

  it('ignores build metadata after + or - when ordering', () => {
    expect(compareVersions('2.11.0+content.2026-07-06', '2.11.0')).toBe(0);
    expect(compareVersions('2.11.0+content.2026-01-01', '2.11.0+content.2026-12-31')).toBe(0);
  });
});

describe('contentPack/isResourcePathSafe', () => {
  it('accepts repo-relative resource paths', () => {
    expect(isResourcePathSafe('template-manifests/ranking-ordered-bar.manifest.json')).toBe(true);
    expect(isResourcePathSafe('data-visualization-templates-xml/kpi-text.xml')).toBe(true);
  });

  it('rejects traversal, absolute, and home-relative paths', () => {
    expect(isResourcePathSafe('../secrets.json')).toBe(false);
    expect(isResourcePathSafe('template-manifests/../../etc/passwd')).toBe(false);
    expect(isResourcePathSafe('/etc/passwd')).toBe(false);
    expect(isResourcePathSafe('~/secrets')).toBe(false);
    expect(isResourcePathSafe('')).toBe(false);
  });
});

describe('contentPack/parsePackManifest — watch-class boundary', () => {
  it('accepts a well-formed manifest', () => {
    const r = parsePackManifest(validManifest());
    expect(r.isOk()).toBe(true);
    expect(r.unwrap().schema_version).toBe('1');
  });

  it('rejects a non-object', () => {
    expect(parsePackManifest(null).isErr()).toBe(true);
    expect(parsePackManifest('nope').isErr()).toBe(true);
  });

  it('rejects a non-integer schema_version', () => {
    const m = { ...validManifest(), schema_version: '1.2' };
    const r = parsePackManifest(m);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().join(' ')).toMatch(/schema_version/);
  });

  it('rejects a bad generated date', () => {
    const m = { ...validManifest(), generated: '07/06/2026' };
    expect(parsePackManifest(m).isErr()).toBe(true);
  });

  it('rejects an empty resources array', () => {
    const m = { ...validManifest(), resources: [] };
    expect(parsePackManifest(m).isErr()).toBe(true);
  });

  it('rejects a resource with a non-64-hex sha256', () => {
    const m = validManifest();
    m.resources[0] = { ...m.resources[0], sha256: 'deadbeef' };
    const r = parsePackManifest(m);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().join(' ')).toMatch(/sha256/);
  });

  it('rejects a resource with non-positive bytes', () => {
    const m = validManifest();
    m.resources[0] = { ...m.resources[0], bytes: 0 };
    expect(parsePackManifest(m).isErr()).toBe(true);
  });

  it('rejects a resource with an unsafe (traversal) path', () => {
    const m = validManifest();
    m.resources[0] = { ...m.resources[0], path: '../../etc/passwd' };
    const r = parsePackManifest(m);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr().join(' ')).toMatch(/path/);
  });

  it('rejects a missing engine_compat.server_min', () => {
    const m = validManifest();
    (m.engine_compat as { server_min?: string }).server_min = undefined;
    expect(parsePackManifest(m).isErr()).toBe(true);
  });
});

describe('contentPack/parseSignedPackManifest — watch-class boundary', () => {
  it('accepts a well-formed signed envelope', () => {
    const signed = {
      manifest: validManifest(),
      signature: 'abc123',
      signature_algorithm: 'fake-sha256',
    };
    const r = parseSignedPackManifest(signed);
    expect(r.isOk()).toBe(true);
  });

  it('rejects a missing/empty signature', () => {
    const signed = { manifest: validManifest(), signature: '', signature_algorithm: 'fake' };
    expect(parseSignedPackManifest(signed).isErr()).toBe(true);
  });

  it('rejects a missing signature_algorithm', () => {
    const signed = { manifest: validManifest(), signature: 'abc' };
    expect(parseSignedPackManifest(signed).isErr()).toBe(true);
  });

  it('propagates manifest errors', () => {
    const signed = {
      manifest: { ...validManifest(), schema_version: 'x' },
      signature: 'abc',
      signature_algorithm: 'fake',
    };
    expect(parseSignedPackManifest(signed).isErr()).toBe(true);
  });
});

describe('contentPack/canonicalizePackManifest', () => {
  it('is stable regardless of key insertion order', () => {
    const a = validManifest();
    const b: PackManifest = {
      resources: a.resources,
      engine_compat: { node: a.engine_compat.node, server_min: a.engine_compat.server_min },
      generated: a.generated,
      schema_version: a.schema_version,
      content_version: a.content_version,
      pack_format_version: a.pack_format_version,
    };
    expect(canonicalizePackManifest(a)).toBe(canonicalizePackManifest(b));
  });

  it('changes when a field value changes (so the signature covers content)', () => {
    const a = validManifest();
    const b = { ...validManifest(), content_version: '2.12.0+content.2026-08-01' };
    expect(canonicalizePackManifest(a)).not.toBe(canonicalizePackManifest(b));
  });
});
