import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Finding 5: the build.ts `stagedDesktopData` allowlist is manual — nothing otherwise
// proves that every resource the shipped content-manifest.json declares actually lands
// under a staged root. A resource added to the manifest (its sha256 baked into the
// integrity gate) but NOT to the allowlist would ship a pack whose hashes reference files
// missing from the tarball → the provider's hash gate rejects a resource that was never
// copied. This test closes that gap WITHOUT executing build.ts (it runs an IIFE at import).
//
// TR1 fix: build.ts previously ran a blanket `copyDirectory('./src/desktop/data', ...)`
// BEFORE the allowlist loop, so the allowlist was cosmetic and any large asset dropped into
// src/desktop/data/ (or a future one) rode into the tarball. The allowlist is now
// AUTHORITATIVE — build.ts stages only the entries below. These tests pin that: every listed
// entry stages, the ~10 MB TWB trim source under src/desktop/data-source/ can never be
// staged, and build.ts keeps no blanket copy that would bypass the allowlist.
//
// LOCKSTEP: STAGED_DESKTOP_DATA mirrors the allowlist in src/scripts/build.ts
// (`stagedDesktopData`). build.ts cannot be imported without side effects, so the list is
// duplicated here; the "build.ts allowlist stays in lockstep" test below parses build.ts and
// fails if the two lists diverge (there is a matching LOCKSTEP note in build.ts).
const STAGED_DESKTOP_DATA = [
  'template-manifests',
  'template-manifests.index.json',
  'template-manifests.fixture.json',
  'content-manifest.json',
  'data-visualization-templates-xml',
  'templates',
  'tableau-desktop-commands-reference.json',
  'workbook-schema-reference.json',
  'corpus.json',
  'twb-example-index.json',
  'examples',
] as const;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_SOURCE_DIR = path.join(__dirname, '..', 'data-source');
const CONTENT_MANIFEST_PATH = path.join(DATA_DIR, 'content-manifest.json');
const BUILD_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'build.ts');

interface ContentManifestResource {
  path: string;
  sha256: string;
  bytes: number;
}

function readManifestResources(): ContentManifestResource[] {
  const raw = JSON.parse(fs.readFileSync(CONTENT_MANIFEST_PATH, 'utf8')) as {
    resources: ContentManifestResource[];
  };
  return raw.resources;
}

// Parse the `stagedDesktopData` array literal out of build.ts so the test asserts against the
// real allowlist rather than a hand-copied duplicate that could silently drift.
function readBuildAllowlist(): string[] {
  const src = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
  const match = src.match(/const stagedDesktopData = \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('could not locate the stagedDesktopData allowlist in src/scripts/build.ts');
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('content-manifest staging allowlist (build.ts) covers every declared resource', () => {
  const resources = readManifestResources();
  const allowlist = new Set<string>(STAGED_DESKTOP_DATA);

  it('the content manifest declares at least one resource (guards a silent-empty regression)', () => {
    expect(resources.length).toBeGreaterThan(0);
  });

  it('every declared resource file exists under src/desktop/data/', () => {
    for (const r of resources) {
      const abs = path.join(DATA_DIR, r.path);
      expect(fs.existsSync(abs), `${r.path} exists under src/desktop/data/`).toBe(true);
    }
  });

  it("every declared resource's first path segment is in the build.ts staging allowlist", () => {
    for (const r of resources) {
      // For a top-level file (no slash) the first segment is the exact filename; for a
      // nested resource it is the directory root the allowlist stages recursively.
      const firstSegment = r.path.split('/')[0];
      expect(
        allowlist.has(firstSegment),
        `${r.path} → '${firstSegment}' is staged by build.ts`,
      ).toBe(true);
    }
  });
});

describe('desktop-data staging allowlist is authoritative (build.ts TR1 fix)', () => {
  it('every allowlisted entry exists under src/desktop/data/ (so staging cannot silently drop one)', () => {
    for (const entry of STAGED_DESKTOP_DATA) {
      const abs = path.join(DATA_DIR, entry);
      expect(fs.existsSync(abs), `${entry} exists under src/desktop/data/`).toBe(true);
    }
  });

  it('ships the committed TRIMMED twb-example-index.json (< 1 MB), not the ungzipped source', () => {
    const stat = fs.statSync(path.join(DATA_DIR, 'twb-example-index.json'));
    expect(stat.size).toBeLessThan(1024 * 1024);
  });

  it('the ~10 MB TWB trim source lives outside the staged dir and is never allowlisted', () => {
    // The trim source is a sibling of data/, so the by-name copy from src/desktop/data/
    // can never reach it, and it is not (and must not be) an allowlist entry.
    expect(fs.existsSync(path.join(DATA_SOURCE_DIR, 'twb-example-index.source.json.gz'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(DATA_DIR, 'data-source'))).toBe(false);
    expect(new Set<string>(STAGED_DESKTOP_DATA).has('data-source')).toBe(false);
  });

  it('build.ts stages ONLY through the allowlist — no blanket copy of src/desktop/data', () => {
    // Strip `//` line comments so a historical mention of the removed call in a comment does
    // not trip this guard — only an actual copyDirectory() CALL in code should fail it.
    const code = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8').replace(/\/\/.*$/gm, '');
    expect(
      /copyDirectory\(\s*['"]\.\/src\/desktop\/data['"]/.test(code),
      'build.ts must not copy the whole src/desktop/data directory (bypasses the allowlist)',
    ).toBe(false);
  });

  it('the build.ts allowlist stays in lockstep with STAGED_DESKTOP_DATA', () => {
    const buildAllowlist = readBuildAllowlist();
    expect(new Set(buildAllowlist)).toEqual(new Set<string>(STAGED_DESKTOP_DATA));
    expect(buildAllowlist).toHaveLength(STAGED_DESKTOP_DATA.length);
  });
});
