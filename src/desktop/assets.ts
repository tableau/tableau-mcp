// Asset access for the desktop variant. When the server runs as a Node.js Single
// Executable Application (SEA) there is no filesystem next to the binary, so the
// data/resource files are embedded in the SEA blob and read via node:sea. When
// running from a normal build or under tests, the same calls fall back to reading
// the files from disk. SEA asset keys are forward-slash paths relative to the
// build root, e.g. "desktop/data/corpus.json" or
// "resources/desktop/knowledge/viz-design/chart-selection.md".

import { createHash } from 'crypto';
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
    // Unbundled source/vitest: getDirname() is src/utils, so the data dir is a sibling.
    join(safeDirname(), '..', 'desktop', 'data'),
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

type ManifestEntry = { sha256: string; bytes: number };

let _seaApi: SeaApi | null | undefined;
let _manifest: Map<string, ManifestEntry> | undefined;
const _verifiedAssets = new Map<string, string>();

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

function readSeaAssetBytes(key: string): Buffer | null {
  const sea = getSeaApi();
  if (!sea) {
    return null;
  }
  try {
    const asset = sea.getAsset(key);
    return typeof asset === 'string' ? Buffer.from(asset, 'utf-8') : Buffer.from(asset);
  } catch {
    return null;
  }
}

// The SEA asset manifest maps every embedded asset key to its build-time sha256 and
// byte length. buildSea.ts hashes each file as it embeds it, so coverage cannot drift:
// a newly embedded asset is automatically verifiable at runtime.
function getManifest(): Map<string, ManifestEntry> {
  if (_manifest !== undefined) {
    return _manifest;
  }
  const raw = readSeaAssetText(MANIFEST_KEY);
  if (raw === null) {
    throw new Error(`SEA asset listing '${MANIFEST_KEY}' is missing or unreadable`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected an object mapping asset keys to { sha256, bytes }');
    }
    const entries = new Map<string, ManifestEntry>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as ManifestEntry).sha256 !== 'string' ||
        typeof (value as ManifestEntry).bytes !== 'number'
      ) {
        throw new Error(`entry '${key}' must be { sha256: string, bytes: number }`);
      }
      entries.set(key, {
        sha256: (value as ManifestEntry).sha256,
        bytes: (value as ManifestEntry).bytes,
      });
    }
    _manifest = entries;
  } catch (error) {
    throw new Error(`SEA asset listing '${MANIFEST_KEY}' is corrupt: ${(error as Error).message}`);
  }
  return _manifest;
}

function listSeaAssetKeys(dirKey: string): string[] {
  const prefix = dirKey.endsWith('/') ? dirKey : `${dirKey}/`;
  return [...getManifest().keys()].filter((key) => key.startsWith(prefix));
}

// Read an embedded SEA asset by its full manifest key and verify its bytes against
// the manifest's sha256. Returns null when the key is not embedded (fail-closed for
// callers that treat "absent" as "not found"); throws when a listed asset is missing,
// unreadable, or fails the integrity check.
function readVerifiedSeaAsset(key: string): string | null {
  const cached = _verifiedAssets.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const expected = getManifest().get(key);
  if (!expected) {
    return null;
  }
  const bytes = readSeaAssetBytes(key);
  if (bytes === null) {
    throw new Error(`SEA asset '${key}' is listed but missing or unreadable`);
  }
  const actualHash = sha256(bytes);
  const actualBytes = bytes.byteLength;
  if (actualHash !== expected.sha256 || actualBytes !== expected.bytes) {
    throw new Error(
      `SEA asset '${key}' failed sha256 integrity check: expected ${expected.sha256} ` +
        `(${expected.bytes} bytes), got ${actualHash} (${actualBytes} bytes)`,
    );
  }
  const text = bytes.toString('utf-8');
  _verifiedAssets.set(key, text);
  return text;
}

function toForwardSlash(value: string): string {
  return value.split('\\').join('/');
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// --- Logical asset accessors (SEA-aware, disk fallback) ---

export function readDataAsset(relPath: string): string | null {
  const rel = toForwardSlash(relPath);
  if (runningAsSea()) {
    return readVerifiedSeaAsset(`desktop/data/${rel}`);
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
    return getManifest().has(`desktop/data/${rel}`);
  }
  return existsSync(join(getDataRoot(), ...rel.split('/')));
}

export function _setSeaApiForTest(seaApi: SeaApi | null): void {
  _seaApi = seaApi;
  _manifest = undefined;
  _verifiedAssets.clear();
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
    return readVerifiedSeaAsset(`resources/desktop/${rel}`);
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
