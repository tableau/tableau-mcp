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
// LOCKSTEP: STAGED_DESKTOP_DATA mirrors the allowlist in src/scripts/build.ts
// (`stagedDesktopData`). build.ts cannot be imported without side effects, so the list is
// duplicated here; keep the two in sync (there is a matching LOCKSTEP note in build.ts).
const STAGED_DESKTOP_DATA = [
  'template-manifests',
  'template-manifests.index.json',
  'template-manifests.fixture.json',
  'content-manifest.json',
  'data-visualization-templates-xml',
] as const;

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONTENT_MANIFEST_PATH = path.join(DATA_DIR, 'content-manifest.json');

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
