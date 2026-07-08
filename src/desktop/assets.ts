// Asset access for the desktop variant. When the server runs as a Node.js Single
// Executable Application (SEA) there is no filesystem next to the binary, so the
// data/resource files are embedded in the SEA blob and read via node:sea. When
// running from a normal build or under tests, the same calls fall back to reading
// the files from disk. SEA asset keys are forward-slash paths relative to the
// build root, e.g. "desktop/data/corpus.json" or
// "resources/desktop/knowledge/viz-design/chart-selection.md".

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { getDirname } from '../utils/getDirname.js';

const MANIFEST_KEY = 'asset-manifest.json';

function safeDirname(): string {
  try {
    const dir = getDirname();
    return typeof dir === 'string' ? dir : process.cwd();
  } catch {
    return process.cwd();
  }
}

// Roots are resolved lazily (not cached at module load) so tests that stub
// getDirname after import, and SEA-vs-disk differences, both behave correctly.
function resolveRoot(candidates: string[]): string {
  return candidates.find(existsSync) ?? candidates[0];
}

export function getDataRoot(): string {
  return resolveRoot([
    join(safeDirname(), 'desktop', 'data'),
    join(safeDirname(), '..', 'src', 'desktop', 'data'),
  ]);
}

export function getResourcesRoot(): string {
  return resolveRoot([
    join(safeDirname(), 'resources', 'desktop'),
    join(safeDirname(), '..', 'resources', 'desktop'),
  ]);
}

// Eager snapshots retained for call sites that still build absolute paths and
// for the CORPUS_PATH/TEMPLATES_DIR-style env overrides used in tests.
export const DATA_ROOT = getDataRoot();
export const RESOURCES_ROOT = getResourcesRoot();

type SeaApi = {
  isSea: () => boolean;
  getAsset: (key: string, encoding?: string) => string | ArrayBuffer;
};

let _seaApi: SeaApi | null | undefined;

function getSeaApi(): SeaApi | null {
  if (_seaApi !== undefined) {
    return _seaApi;
  }
  try {
    // node:sea is only meaningful inside a SEA; require may be unavailable under
    // some test runtimes, so guard it. isSea() returns false outside a SEA.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _seaApi = require('node:sea') as SeaApi;
  } catch {
    _seaApi = null;
  }
  return _seaApi;
}

export function runningAsSea(): boolean {
  try {
    return getSeaApi()?.isSea() ?? false;
  } catch {
    return false;
  }
}

function readSeaAssetText(key: string): string | null {
  const sea = getSeaApi();
  if (!sea) {
    return null;
  }
  try {
    const asset = sea.getAsset(key, 'utf8');
    return typeof asset === 'string' ? asset : null;
  } catch {
    return null;
  }
}

let _manifest: string[] | null | undefined;

function getManifest(): string[] {
  if (_manifest !== undefined && _manifest !== null) {
    return _manifest;
  }
  const raw = readSeaAssetText(MANIFEST_KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    _manifest = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    _manifest = [];
  }
  return _manifest;
}

function listSeaAssetKeys(dirKey: string): string[] {
  const prefix = dirKey.endsWith('/') ? dirKey : `${dirKey}/`;
  return getManifest().filter((key) => key.startsWith(prefix));
}

function toForwardSlash(value: string): string {
  return value.split('\\').join('/');
}

// --- Logical asset accessors (SEA-aware, disk fallback) ---

export function readDataAsset(relPath: string): string | null {
  const rel = toForwardSlash(relPath);
  if (runningAsSea()) {
    return readSeaAssetText(`desktop/data/${rel}`);
  }
  try {
    return readFileSync(join(getDataRoot(), ...rel.split('/')), 'utf-8');
  } catch {
    return null;
  }
}

export function dataAssetExists(relPath: string): boolean {
  const rel = toForwardSlash(relPath);
  if (runningAsSea()) {
    return getManifest().includes(`desktop/data/${rel}`);
  }
  return existsSync(join(getDataRoot(), ...rel.split('/')));
}

// File names (not full paths) of the entries under a desktop/data subdirectory.
// Filtering by extension is left to the caller.
export function listDataAssetNames(subDir: string): string[] {
  const rel = toForwardSlash(subDir);
  if (runningAsSea()) {
    const prefix = `desktop/data/${rel}/`;
    return listSeaAssetKeys(`desktop/data/${rel}`)
      .map((key) => key.slice(prefix.length))
      .filter((name) => name.length > 0);
  }
  try {
    return readdirSync(join(getDataRoot(), ...rel.split('/')));
  } catch {
    return [];
  }
}

export function readResourceAsset(relPath: string): string | null {
  const rel = toForwardSlash(relPath);
  if (runningAsSea()) {
    return readSeaAssetText(`resources/desktop/${rel}`);
  }
  try {
    return readFileSync(join(getResourcesRoot(), ...rel.split('/')), 'utf-8');
  } catch {
    return null;
  }
}

// Knowledge module slugs (forward-slash, no .md) under resources/desktop/knowledge.
// SEA reads the manifest; disk walks the tree.
export function listKnowledgeSlugs(): string[] {
  if (runningAsSea()) {
    const prefix = 'resources/desktop/knowledge/';
    return listSeaAssetKeys('resources/desktop/knowledge')
      .filter((key) => key.endsWith('.md'))
      .map((key) => key.slice(prefix.length).replace(/\.md$/, ''))
      .sort();
  }
  const root = join(getResourcesRoot(), 'knowledge');
  const slugs: string[] = [];
  const walk = (dir: string, prefixParts: string[]): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next, [...prefixParts, entry.name]);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        slugs.push([...prefixParts, entry.name.replace(/\.md$/, '')].join('/'));
      }
    }
  };
  walk(root, []);
  return slugs.sort();
}

export function readKnowledgeBySlug(slug: string): string | null {
  if (!slug || slug.includes('..') || slug.includes('\\') || slug.startsWith('/')) {
    return null;
  }
  return readResourceAsset(`knowledge/${slug}.md`);
}
