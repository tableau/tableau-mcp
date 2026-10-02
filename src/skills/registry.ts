import { createHash } from 'node:crypto';
import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { lookup } from 'mime-types';
import { fromError } from 'zod-validation-error/v3';

import { log } from '../logging/logger.js';
import {
  type SkillEntry as SkillData,
  SkillFrontmatterSchema,
  type SkillResource,
} from './types.js';

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
  list: () => { skills: SkillData[] };
  get: (uri: string) => SkillData | undefined;
  files: () => SkillFile[];
};

const SKILL_MANIFEST = 'SKILL.md';
const LOGGER = 'skills';

// Use mime-types to find the file type for a file path; `lookup` returns `false`
// for unknown/extensionless files, so fall back to a binary type.
function mimeTypeFor(filePath: string): string {
  return lookup(filePath) || 'application/octet-stream';
}

// TODO W-24281166: Skills currently live under `src/skills/mockSkills` until we can read from
// the public repository. Once skills are synced from there, the sync must also refresh the cached
// registry (`resetSkillRegistry`) and re-register resources, or reads will hit stale paths.
function getSkillsDir(): string {
  return resolve(process.cwd(), 'src', 'skills', 'mockSkills');
}

/**
 * Parse a SKILL.md-style leading frontmatter block. Supports a single `---`-delimited block
 * of flat `key: value` lines (blank lines ignored). Returns an empty object when no
 * frontmatter block is present.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  // Match a block of text beginning and ending with `---`, capturing its inner body
  // into match[1]. ^\uFEFF?  allows an optional UTF-8 byte-order mark
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    return {};
  }

  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
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
    frontmatter[key] = trimmed.slice(colon + 1).trim();
  }
  return frontmatter;
}

/** Recursively collect every non-dotfile (not directory) under `dir`, as absolute paths. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Skip dotfiles and dot-directories (.DS_Store, .git, .*.swp, ...)
    if (entry.name.startsWith('.')) {
      continue;
    }
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

function makeRegistry(sortedEntries: SkillData[], fileEntries: SkillFile[]): SkillRegistry {
  const byUri = new Map<string, SkillData>(sortedEntries.map((e) => [e.uri, e]));
  return {
    list: () => ({ skills: sortedEntries }),
    get: (uri: string) => byUri.get(uri),
    files: () => fileEntries,
  };
}

/**
 * Build a skill registry by traversing through src/skills/mockSkills.
 * Every file in the directory (including `SKILL.md`) becomes a resource with a SHA-256 digest
 * and byte size. Malformed or incomplete skills are skipped with a warning; a missing skills
 * directory yields an empty registry. Pure/uncached; callers memoize via `getSkillRegistry`.
 */
export function buildSkillRegistry(skillsDir: string = getSkillsDir()): SkillRegistry {
  let directories: Dirent[];
  try {
    directories = readdirSync(skillsDir, { withFileTypes: true });
  } catch (error) {
    // If there are no skills found, return an empty registry
    log({
      level: 'info',
      message: `No skills directory found at ${skillsDir}; serving 0 skills.`,
      logger: LOGGER,
      data: error,
    });
    return makeRegistry([], []);
  }

  const skillData: SkillData[] = [];
  // files represents a lookup table for all skill-related resources/scripts/assets
  const files: SkillFile[] = [];

  for (const directory of directories) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) {
      continue;
    }

    const name = directory.name;
    const skillPath = join(skillsDir, name);
    const manifestPath = join(skillPath, SKILL_MANIFEST);

    let manifest: string;
    try {
      // Retrieve contents of SKILL.md file
      manifest = readFileSync(manifestPath, 'utf-8');
    } catch {
      log({
        level: 'warning',
        message: `Skill "${name}" has no ${SKILL_MANIFEST}; skipping.`,
        logger: LOGGER,
      });
      continue;
    }

    // Validate the required "name" and "description" frontmatter before collecting any files
    const frontmatter = SkillFrontmatterSchema.safeParse(parseFrontmatter(manifest));
    if (!frontmatter.success) {
      log({
        level: 'warning',
        message: `Skill "${name}" ${SKILL_MANIFEST} has invalid frontmatter; skipping. ${fromError(frontmatter.error).toString()}`,
        logger: LOGGER,
      });
      continue;
    }

    const skillResources: SkillResource[] = [];
    for (const absPath of walkFiles(skillPath).sort()) {
      const relPath = relative(skillPath, absPath).split(sep).join('/');
      const uri = `skill://${name}/${relPath}`;
      const bytes = readFileSync(absPath);
      skillResources.push({ uri, digest: sha256(bytes), size: bytes.byteLength });
      files.push({ uri, path: absPath, mimeType: mimeTypeFor(absPath) });
    }

    // Add information from a single skill into the list of skillData
    skillData.push({
      uri: `skill://${name}/${SKILL_MANIFEST}`,
      frontmatter: frontmatter.data,
      resources: skillResources,
    });
  }

  skillData.sort(byUriAsc);
  files.sort(byUriAsc);

  log({
    level: 'info',
    message: `Loaded ${skillData.length} skill(s) from ${skillsDir}.`,
    logger: LOGGER,
  });

  return makeRegistry(skillData, files);
}

let cached: SkillRegistry | undefined;

/**
 * Module-level singleton skill registry, built once from the resolved skills directory and
 * memoized.
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
