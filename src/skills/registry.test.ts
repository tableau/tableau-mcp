import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logging/logger.js', () => ({
  log: vi.fn(),
}));

import { log } from '../logging/logger.js';
import { buildSkillRegistry, getSkillRegistry, resetSkillRegistry } from './registry.js';

// SHA-256 digest in the `sha256:<hex>` form the registry emits.
const registryDigest = (content: string | Buffer): string =>
  `sha256:${createHash('sha256').update(content).digest('hex')}`;

// Build a `---`-delimited frontmatter block from flat key/value pairs, plus a body.
const manifest = (frontmatter: Record<string, string>, body = 'Skill body.'): string => {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};

// Log entries the code under test passed to the mocked logger, filtered by level.
const mockLogs = (level: string): Array<{ level: string; message: string }> =>
  vi
    .mocked(log)
    .mock.calls.map((c) => c[0])
    .filter((e) => e.level === level);

// Example description in the test skill's frontmatter
const DESCRIPTION =
  'A minimal test skill used to verify the skills-over-mcp wiring end to end. Prints a start ' +
  "marker, lists the user's Tableau workbooks with the list-workbooks tool, and prints a " +
  'completion marker.';

const body = (name: string): string =>
  [
    `# ${name}`,
    '',
    'A skill for exercising the skills-over-mcp path. Follow these steps in order.',
    '',
    '## Instructions',
    '',
    '1. Print `this is a test skill.`',
    "2. Use the `list-workbooks` tool to list all of the user's workbooks.",
    '3. Print `test skill complete`.',
  ].join('\n');

const skillManifest = (name: string): string =>
  manifest({ name, description: DESCRIPTION }, body(name));

const readme = (name: string): string =>
  `# ${name}\n\nA test skill used to verify the **skills-over-mcp** integration end to end.\n`;

const LIST_WORKBOOKS_REF =
  '# Listing workbooks\n\nSupporting reference for the list-workbooks step. Use the ' +
  '`list-workbooks` tool; no parameters are required to list everything.\n';

describe('registry', () => {
  let skillsDir: string;

  // Create a file at a specified path
  const writeMockFile = (relPath: string, content: string): void => {
    const fullPath = join(skillsDir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  };

  // Create `<name>/SKILL.md` file plus any extra `relPath -> content` files.
  const createSkillManifest = (
    name: string,
    manifestText: string,
    files: Record<string, string> = {},
  ): void => {
    writeMockFile(join(name, 'SKILL.md'), manifestText);
    for (const [rel, content] of Object.entries(files)) {
      writeMockFile(join(name, rel), content);
    }
  };

  // Write a full skill (SKILL.md + README + reference files)
  const writeTestSkill = (name = 'test-skill', extraFiles: Record<string, string> = {}): void =>
    createSkillManifest(name, skillManifest(name), {
      'README.md': readme(name),
      'skill-expertise/list-workbooks.md': LIST_WORKBOOKS_REF,
      ...extraFiles,
    });

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), 'skills-registry-'));
    vi.clearAllMocks();
    resetSkillRegistry();
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  describe('frontmatter parsing', () => {
    it('parses the name and description from a test-skill-style manifest', () => {
      writeTestSkill('test-skill');

      const { skills } = buildSkillRegistry(skillsDir).list();

      expect(skills).toHaveLength(1);
      expect(skills[0].frontmatter).toEqual({ name: 'test-skill', description: DESCRIPTION });
    });

    it('skips a skill whose SKILL.md is missing required frontmatter', () => {
      createSkillManifest('test-skill', manifest({ name: 'test-skill' }, body('test-skill'))); // no description

      const { skills } = buildSkillRegistry(skillsDir).list();

      expect(skills).toHaveLength(0);
      expect(mockLogs('warning')[0].message).toContain('missing required frontmatter');
    });

    it('skips a skill with no frontmatter block at all', () => {
      createSkillManifest('test-skill', '# test-skill\n\nNo frontmatter here.\n');

      const { skills } = buildSkillRegistry(skillsDir).list();

      expect(skills).toHaveLength(0);
      expect(mockLogs('warning')).toHaveLength(1);
    });

    it('skips a skill whose frontmatter name does not match the directory name', () => {
      createSkillManifest('test-skill', skillManifest('wrong-name'));

      const { skills } = buildSkillRegistry(skillsDir).list();

      expect(skills).toHaveLength(0);
      expect(mockLogs('warning')[0].message).toContain('does not match its directory name');
    });

    it('skips a directory that has no SKILL.md', () => {
      writeMockFile(join('test-skill', 'README.md'), readme('test-skill')); // README but no manifest

      const { skills } = buildSkillRegistry(skillsDir).list();

      expect(skills).toHaveLength(0);
      expect(mockLogs('warning')[0].message).toContain('has no SKILL.md');
    });
  });

  describe('resource digests and sizes', () => {
    it('computes the SHA-256 digest and raw byte size for every file, including SKILL.md', () => {
      const manifestText = skillManifest('test-skill');
      writeTestSkill('test-skill');

      const entry = buildSkillRegistry(skillsDir).get('skill://test-skill/SKILL.md');

      expect(entry).toBeDefined();
      expect(entry!.resources).toHaveLength(3);
      const byUri = Object.fromEntries(entry!.resources.map((r) => [r.uri, r]));

      const manifestResource = byUri['skill://test-skill/SKILL.md'];
      expect(manifestResource.digest).toBe(registryDigest(manifestText));
      expect(manifestResource.size).toBe(Buffer.byteLength(manifestText));

      const refResource = byUri['skill://test-skill/skill-expertise/list-workbooks.md'];
      expect(refResource.digest).toBe(registryDigest(LIST_WORKBOOKS_REF));
      expect(refResource.size).toBe(Buffer.byteLength(LIST_WORKBOOKS_REF));
      expect(refResource.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('includes nested files with forward-slash relative URIs', () => {
      writeTestSkill('test-skill');

      const uris = buildSkillRegistry(skillsDir)
        .get('skill://test-skill/SKILL.md')!
        .resources.map((r) => r.uri);

      expect(uris).toContain('skill://test-skill/skill-expertise/list-workbooks.md');
    });
  });

  describe('files()', () => {
    it('returns a path and mime type for every skill file', () => {
      writeTestSkill('test-skill', { LICENSE: 'MIT' }); // extensionless → binary fallback

      const files = buildSkillRegistry(skillsDir).files();
      const byUri = Object.fromEntries(files.map((f) => [f.uri, f]));

      expect(byUri['skill://test-skill/SKILL.md'].mimeType).toBe('text/markdown');
      expect(byUri['skill://test-skill/README.md'].mimeType).toBe('text/markdown');
      expect(byUri['skill://test-skill/skill-expertise/list-workbooks.md'].mimeType).toBe(
        'text/markdown',
      );
      expect(byUri['skill://test-skill/SKILL.md'].path).toBe(
        join(skillsDir, 'test-skill', 'SKILL.md'),
      );
      expect(byUri['skill://test-skill/LICENSE'].mimeType).toBe('application/octet-stream');
    });
  });

  describe('discovery, sorting, and lookup', () => {
    it('loads multiple skills sorted by URI and ignores non-directory entries', () => {
      writeTestSkill('test-skill');
      writeTestSkill('another-skill');
      writeMockFile('stray.txt', 'not a skill'); // top-level file must be ignored

      const registry = buildSkillRegistry(skillsDir);

      expect(registry.list().skills.map((s) => s.uri)).toEqual([
        'skill://another-skill/SKILL.md',
        'skill://test-skill/SKILL.md',
      ]);
      // files() is also sorted by URI (each skill contributes SKILL.md + README + reference)
      const uris = registry.files().map((f) => f.uri);
      expect(uris).toHaveLength(6);
      expect(uris).toEqual([...uris].sort());
    });

    it('get() returns the entry for a known URI and undefined otherwise', () => {
      writeTestSkill('test-skill');

      const registry = buildSkillRegistry(skillsDir);

      expect(registry.get('skill://test-skill/SKILL.md')?.uri).toBe('skill://test-skill/SKILL.md');
      expect(registry.get('skill://nope/SKILL.md')).toBeUndefined();
    });
  });

  describe('empty and missing directories', () => {
    it('returns an empty registry for an empty skills directory', () => {
      const registry = buildSkillRegistry(skillsDir);

      expect(registry.list().skills).toEqual([]);
      expect(registry.files()).toEqual([]);
    });

    it('returns an empty registry when the skills directory is missing', () => {
      const missing = join(skillsDir, 'does-not-exist');

      const registry = buildSkillRegistry(missing);

      expect(registry.list().skills).toEqual([]);
      expect(registry.files()).toEqual([]);
      expect(mockLogs('info').some((e) => e.message.includes('No skills directory found'))).toBe(
        true,
      );
    });
  });

  describe('getSkillRegistry / resetSkillRegistry', () => {
    it('memoizes the registry across calls and rebuilds after reset', async () => {
      const first = await getSkillRegistry();
      const second = await getSkillRegistry();
      expect(second).toBe(first);

      resetSkillRegistry();
      const third = await getSkillRegistry();
      expect(third).not.toBe(first);
    });
  });
});
