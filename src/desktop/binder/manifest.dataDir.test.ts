import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { dataDirCandidates, pickDataDir } from './manifest.js';

// Publish-story proof (Lane M4 day-4): the bundled server resolves its data
// package-relative from `build/desktop/data` (resolveDataDir candidate 2). These
// tests fake the `__dirname` layouts so the candidate ordering + selection is proven
// without needing a real `npm run build` in the test run (that is verified separately
// via `npm run build` + `npm pack --dry-run`).

const INDEX = 'template-manifests.index.json';

describe('binder/manifest — DATA_DIR resolution', () => {
  const tmps: string[] = [];
  function mkTmp(): string {
    const d = mkdtempSync(path.join(tmpdir(), 'mcp-datadir-'));
    tmps.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of tmps.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('orders candidates source → bundled build/desktop/data → cwd fallback', () => {
    const c = dataDirCandidates(path.join('/pkg', 'build'), '/repo');
    expect(c[0]).toBe(path.join('/pkg', 'data')); // build/../data (source layout)
    expect(c[1]).toBe(path.join('/pkg', 'build', 'desktop', 'data')); // published bundle
    expect(c[2]).toBe(path.join('/repo', 'src', 'desktop', 'data')); // legacy cwd fallback
  });

  it('selects the bundled candidate-2 when only build/desktop/data carries the index', () => {
    // Simulate __dirname === build/ of a published package: only build/desktop/data exists.
    const build = mkTmp();
    const bundled = path.join(build, 'desktop', 'data');
    mkdirSync(bundled, { recursive: true });
    writeFileSync(path.join(bundled, INDEX), '{}');

    const candidates = dataDirCandidates(build, mkTmp());
    expect(existsSync(path.join(candidates[0], INDEX))).toBe(false); // source layout absent
    expect(pickDataDir(candidates)).toBe(bundled);
  });

  it('prefers the source candidate-1 over the bundled candidate-2 when both exist', () => {
    const base = mkTmp();
    const moduleDir = path.join(base, 'src', 'desktop', 'binder');
    mkdirSync(moduleDir, { recursive: true });
    const source = path.join(base, 'src', 'desktop', 'data'); // moduleDir/../data
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, INDEX), '{}');
    const bundled = path.join(moduleDir, 'desktop', 'data');
    mkdirSync(bundled, { recursive: true });
    writeFileSync(path.join(bundled, INDEX), '{}');

    expect(pickDataDir(dataDirCandidates(moduleDir, base))).toBe(source);
  });

  it('falls back to candidate-1 (no throw) when no candidate has the index', () => {
    const candidates = dataDirCandidates(mkTmp(), mkTmp());
    expect(pickDataDir(candidates)).toBe(candidates[0]);
  });
});
