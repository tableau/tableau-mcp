// src/binder/manifest.ts
//
// Tier-1 fast-path binder — manifest loader I/O (design doc §2.1, §3.1).
//
// `loadManifests()` mirrors the repo loader idiom (`src/search/index.ts`
// `loadWorkbookExamples`): a directory listing, `JSON.parse`, and a module-level
// cache. It returns the per-template manifests keyed by template name
// (== filename == inject-template `template_name`). Reads go through the
// SEA-aware assets seam (`readDataAsset`/`listDataAssetNames`, see
// `src/desktop/assets.ts`) so a Single Executable Application binary with no
// on-disk data dir loads the embedded manifests; normal builds/tests fall back
// to the disk data dir exactly like the templates seam (#433).
//
// The PURE half — shape/enum validation (`validateManifest`) plus the eligibility
// predicates (`computeFixtureBind`, `computeFastPathEligible`) — now lives in the
// fs-free, provider-free `manifest-validation.ts` lockstep-core module. This file keeps
// only the loader I/O (fs reads, package-data-dir resolution, module cache) and CALLS
// into it. The pure surface is re-exported below so existing importers of `./manifest.js`
// are unaffected. XML cross-checks (template_field exists as a <column>, placeholders
// present, derivation ∈ derivationMap) live in `manifest.test.ts`, matching the "contract
// enforced by a test" pattern used for knowledge files and plan-binding.

import fs from 'fs';
import path from 'path';

import { listDataAssetNames, readDataAsset, runningAsSea } from '../assets.js';
import type { TemplateManifest } from './manifest-types.js';
import {
  type BinderFixture,
  computeFastPathEligible,
  computeFixtureBind,
  DERIVATIONS,
  FAMILY_VALUES,
  type FixtureField,
  isRenderVerifiedLive,
  validateManifest,
} from './manifest-validation.js';

// Re-export the pure validation surface so existing importers of `./manifest.js`
// (listTemplates FAMILY_VALUES, remoteProvider validateManifest, the binder tests)
// keep working unchanged after the extraction — zero behavior change.
export {
  type BinderFixture,
  computeFastPathEligible,
  computeFixtureBind,
  DERIVATIONS,
  FAMILY_VALUES,
  type FixtureField,
  isRenderVerifiedLive,
  validateManifest,
};

// PORT ADAPTATION + cwd-hazard fix (Lane M3 day 3):
// The source implementation resolved these paths from `fileURLToPath(import.meta.url)`
// (ESM-only, unavailable under this repo's `type: commonjs`). The first port used
// `process.cwd()`, which is correct only when the process starts at the repo root
// (dev / vitest) and BREAKS for an npm-installed server launched from an arbitrary
// cwd. This repo is CommonJS and esbuild-bundles to `build/index.js`, so `__dirname`
// is available in BOTH the unbundled source (`src/desktop/binder`) and the bundle
// (`build/`). We resolve PACKAGE-RELATIVE first, then fall back to cwd for back-compat.
// Candidates are probed for the index file; the first that exists wins.
//
// PUBLISH STORY (closed Lane M4 day-4): the esbuild build now stages
// `src/desktop/data` → `build/desktop/data` (see `src/scripts/build.ts`
// "Staging desktop data") and `.npmignore` ships `build/**/*`, so an npm-installed
// bundle DOES carry the data. Candidate 2 below (`__dirname/desktop/data`, where
// `__dirname === build/` in the bundle) is now the real published resolution path;
// `npm pack --dry-run` shows `build/desktop/data/**` in the tarball. Candidate 1
// serves the unbundled source / tsx-from-repo-root runtime; candidate 3 is the legacy
// cwd fallback. `dataDirCandidates`/`pickDataDir` are split out so the candidate-2
// resolution is unit-tested against faked `__dirname` layouts (manifest.dataDir.test.ts).

/** The ordered DATA_DIR candidates for a given module dir + cwd. Exported for tests. */
export function dataDirCandidates(moduleDir: string, cwd: string): string[] {
  return [
    path.join(moduleDir, '..', 'data'), // unbundled source: src/desktop/binder → src/desktop/data
    path.join(moduleDir, 'desktop', 'data'), // published bundle: build/ → build/desktop/data
    path.join(cwd, 'src', 'desktop', 'data'), // legacy cwd fallback (repo root)
  ];
}

/** Injectable dependencies for `pickDataDir` — defaults hit the real fs + console. */
export interface PickDataDirDeps {
  /** Existence probe (defaults to fs.existsSync). Injected in tests. */
  exists?: (p: string) => boolean;
  /** One-line warning sink (defaults to console.error — the repo's warn idiom). */
  warn?: (message: string) => void;
}

/**
 * First candidate that actually contains the manifest index, else the first candidate.
 *
 * SECURITY SIGNAL (M10 Finding 4): the LAST candidate is the `<cwd>/src/desktop/data`
 * dev fallback. Resolving to it in a packaged install means the packaged candidates were
 * absent (a broken/partial install), so the server would silently serve attacker-plantable
 * cwd content. Resolution ORDER is unchanged (dev workflows rely on the cwd path), but
 * falling through to it now emits a one-line warning naming the resolved path — a broken
 * install is loud, not silent.
 */
export function pickDataDir(candidates: string[], deps: PickDataDirDeps = {}): string {
  const exists = deps.exists ?? ((p: string): boolean => fs.existsSync(p));
  const warn = deps.warn ?? ((m: string): void => console.error(m));
  const cwdFallbackIndex = candidates.length - 1;
  for (let i = 0; i < candidates.length; i++) {
    const dir = candidates[i];
    if (exists(path.join(dir, 'template-manifests.index.json'))) {
      // Only the cwd fallback (the LAST candidate, never the primary) is a security
      // signal; the packaged/source candidates resolving is the normal, silent path.
      if (i === cwdFallbackIndex && cwdFallbackIndex > 0) {
        warn(
          `[tableau-mcp] binder template data resolved to the cwd-relative dev fallback '${dir}'. ` +
            'This path is only expected in a repo-root development run; in a packaged install it ' +
            'indicates a broken/partial package (the packaged data candidates were absent) and the ' +
            'served content is cwd-relative — reinstall the package if this is not a dev environment.',
        );
      }
      return dir;
    }
  }
  return candidates[0];
}

function resolveDataDir(): string {
  return pickDataDir(dataDirCandidates(__dirname, process.cwd()));
}

const DATA_DIR = resolveDataDir();

export const MANIFESTS_DIR = path.join(DATA_DIR, 'template-manifests');
export const MANIFEST_INDEX_PATH = path.join(DATA_DIR, 'template-manifests.index.json');
/** Committed schema fixture the eligibility gate binds against (attacks 5+10). */
export const BINDER_FIXTURE_PATH = path.join(DATA_DIR, 'template-manifests.fixture.json');
/** Generated content manifest (content_version, schema_version, per-resource sha256). */
export const CONTENT_MANIFEST_PATH = path.join(DATA_DIR, 'content-manifest.json');
/** Shipped worksheet-fragment XML for templates whose golden XML ships in-package. */
export const TEMPLATE_XML_DIR = path.join(DATA_DIR, 'data-visualization-templates-xml');
const MANIFEST_SUFFIX = '.manifest.json';

// Asset keys (desktop/data-relative) for the SEA-aware seam. The absolute-path
// constants above remain for consumers that still build disk paths (provider.ts
// TEMPLATE_XML_DIR/CONTENT_MANIFEST_PATH, the manifest tests).
const MANIFESTS_ASSET_DIR = 'template-manifests';
const FIXTURE_ASSET = 'template-manifests.fixture.json';

let _manifestsCache: Map<string, TemplateManifest> | null = null;

let _fixtureCache: BinderFixture | null = null;
/** Load the committed schema fixture the eligibility gate binds against. */
export function loadBinderFixture(): BinderFixture {
  if (_fixtureCache) return _fixtureCache;
  const raw = readDataAsset(FIXTURE_ASSET);
  if (raw === null) {
    // Fail closed like the old fs.readFileSync ENOENT throw.
    throw new Error(
      `Binder fixture asset '${FIXTURE_ASSET}' is missing or unreadable (disk fallback: ${BINDER_FIXTURE_PATH})`,
    );
  }
  const parsed = JSON.parse(raw) as BinderFixture;
  _fixtureCache = parsed;
  return parsed;
}

/**
 * Load every `<template>.manifest.json` under `data/template-manifests/`,
 * validate its shape, and cache the result in a module-level Map keyed by
 * template name. Throws (fail-closed) if any manifest is structurally invalid
 * or if a filename disagrees with its `template` field.
 */
export function loadManifests(): Map<string, TemplateManifest> {
  if (_manifestsCache) return _manifestsCache;
  const cache = new Map<string, TemplateManifest>();
  // Disk builds keep the old empty-cache behavior for a missing directory; SEA
  // builds fail closed below because an empty listing means the embedded supply is broken.
  const files = listDataAssetNames(MANIFESTS_ASSET_DIR)
    .filter((f) => f.endsWith(MANIFEST_SUFFIX))
    .sort();
  if (runningAsSea() && files.length === 0) {
    throw new Error(
      `SEA template manifest asset directory 'desktop/data/${MANIFESTS_ASSET_DIR}' ` +
        'is missing or empty',
    );
  }
  for (const file of files) {
    const raw = readDataAsset(`${MANIFESTS_ASSET_DIR}/${file}`);
    if (raw === null) {
      throw new Error(`Manifest ${file} is missing or unreadable`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Manifest ${file} is not valid JSON: ${(e as Error).message}`);
    }
    const errors = validateManifest(parsed);
    if (errors.length > 0) {
      throw new Error(`Manifest ${file} failed shape validation:\n  - ${errors.join('\n  - ')}`);
    }
    const manifest = parsed as TemplateManifest;
    const expectedName = file.slice(0, -MANIFEST_SUFFIX.length);
    if (manifest.template !== expectedName) {
      throw new Error(
        `Manifest ${file}: template '${manifest.template}' does not match filename '${expectedName}'`,
      );
    }
    cache.set(manifest.template, manifest);
  }
  _manifestsCache = cache;
  return cache;
}

/** Test/tooling hook: drop the module-level cache so the next load re-reads disk. */
export function _resetManifestCache(): void {
  _manifestsCache = null;
}
