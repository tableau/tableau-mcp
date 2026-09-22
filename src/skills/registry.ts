import { createHash } from 'node:crypto';
import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { lookup } from 'mime-types';

import { log } from '../logging/logger.js';
import { getDirname } from '../utils/getDirname.js';
import { type SkillEntry, type SkillResource } from './types.js';

/** Representation of a single skill file */
export type SkillFile = {
  uri: string;
  path: string;
  mimeType: string;
};

/**
 * Read-only view over the skills discovered on disk. Built once and memoized (see
 * `getSkillRegistry`). The accessor methods close over the immutable, pre-sorted data.
 */
export type SkillRegistry = {
  list: () => { skills: SkillEntry[] };
  get: (uri: string) => SkillEntry | undefined;
  files: () => SkillFile[];
};

const SKILLS_DIRNAME = 'skills';
const SKILL_MANIFEST = 'SKILL.md';
const LOGGER = 'skills';

// Use mime-types to find the file type for a file path; `lookup` returns `false`
// for unknown/extensionless files, so fall back to a binary type.
function mimeTypeFor(filePath: string): string {
  return lookup(filePath) || 'application/octet-stream';
}


function getSkillsDir(): string {
  return join(getDirname(), SKILLS_DIRNAME);
}

/**
 * Parse a SKILL.md-style leading frontmatter block. Supports a single `---`-delimited block
 * of flat `key: value` lines (comments and blank lines ignored, surrounding quotes stripped).
 * Returns an empty object when no frontmatter block is present.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    return {};
  }

  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    if (!key) {
      continue;
    }
    let value = trimmed.slice(colon + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return frontmatter;
}

/** Recursively collect every file (not directory) under `dir`, as absolute paths. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function byUriAsc(a: { uri: string }, b: { uri: string }): number {
  return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
}

function makeRegistry(sortedEntries: SkillEntry[], fileEntries: SkillFile[]): SkillRegistry {
  const byUri = new Map<string, SkillEntry>(sortedEntries.map((e) => [e.uri, e]));
  return {
    list: () => ({ skills: sortedEntries }),
    get: (uri: string) => byUri.get(uri),
    files: () => fileEntries,
  };
}

/**
 * Build a skill registry by scanning `skillsDir`. Each immediate subdirectory `<name>/` is a
 * skill; its `SKILL.md` frontmatter must declare `name` (matching `<name>`) and `description`.
 * Every file in the directory (including `SKILL.md`) becomes a resource with a SHA-256 digest
 * and byte size. Malformed or incomplete skills are skipped with a warning; a missing skills
 * directory yields an empty registry. Pure/uncached; callers memoize via `getSkillRegistry`.
 */
export function buildSkillRegistry(skillsDir: string = getSkillsDir()): SkillRegistry {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(skillsDir, { withFileTypes: true });
  } catch (error) {
    // A missing skills directory is a normal "no skills configured" state, not an error.
    log({
      level: 'info',
      message: `No skills directory found at ${skillsDir}; serving 0 skills.`,
      logger: LOGGER,
      data: error,
    });
    return makeRegistry([], []);
  }

  const entries: SkillEntry[] = [];
  const files: SkillFile[] = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const name = dirent.name;
    const skillPath = join(skillsDir, name);
    const manifestPath = join(skillPath, SKILL_MANIFEST);

    let manifest: string;
    try {
      manifest = readFileSync(manifestPath, 'utf-8');
    } catch {
      log({
        level: 'warning',
        message: `Skill "${name}" has no ${SKILL_MANIFEST}; skipping.`,
        logger: LOGGER,
      });
      continue;
    }

    const frontmatter = parseFrontmatter(manifest);
    if (typeof frontmatter.name !== 'string' || typeof frontmatter.description !== 'string') {
      log({
        level: 'warning',
        message: `Skill "${name}" ${SKILL_MANIFEST} is missing required frontmatter "name" and/or "description"; skipping.`,
        logger: LOGGER,
      });
      continue;
    }
    if (frontmatter.name !== name) {
      log({
        level: 'warning',
        message: `Skill "${name}" frontmatter name "${frontmatter.name}" does not match its directory name; skipping.`,
        logger: LOGGER,
      });
      continue;
    }

    const resources: SkillResource[] = [];
    for (const absPath of walkFiles(skillPath).sort()) {
      const relPath = relative(skillPath, absPath).split(sep).join('/');
      const uri = `skill://${name}/${relPath}`;
      const bytes = readFileSync(absPath);
      resources.push({ uri, digest: sha256(bytes), size: bytes.byteLength });
      files.push({ uri, path: absPath, mimeType: mimeTypeFor(absPath) });
    }

    entries.push({
      uri: `skill://${name}/${SKILL_MANIFEST}`,
      frontmatter,
      resources,
    });
  }

  entries.sort(byUriAsc);
  files.sort(byUriAsc);

  log({
    level: 'info',
    message: `Loaded ${entries.length} skill(s) from ${skillsDir}.`,
    logger: LOGGER,
  });

  return makeRegistry(entries, files);
}

let cached: SkillRegistry | undefined;

/**
 * Module-level singleton skill registry, built once from the resolved skills directory and
 * memoized (mirrors the feature-gate singleton). Not hot-reloadable.
 *
 * Async to give later steps room to perform async work without changing the call sites.
 */
export async function getSkillRegistry(): Promise<SkillRegistry> {
  if (!cached) {
    cached = buildSkillRegistry();
  }
  return cached;
}

/** Test-only: clears the memoized registry so the next `getSkillRegistry()` rebuilds. */
export function resetSkillRegistry(): void {
  cached = undefined;
}
