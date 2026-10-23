import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const bundledTemplatesDirectory = join(process.cwd(), 'src/desktop/data/templates');
const shippedDataRoots = ['src/desktop/data', 'resources/desktop'];
const shippedDataDirectories = shippedDataRoots.map((directory) => join(process.cwd(), directory));

const privatePathPatterns = [
  {
    name: 'macOS user home',
    pattern: /\/Users\/[^/\\'"<>\s]+(?:[/\\]|$)/i,
  },
  {
    name: 'POSIX user home',
    pattern: /\/home\/[^/\\'"<>\s]+(?:[/\\]|$)/i,
  },
  {
    name: 'Windows drive user home',
    pattern: /[A-Za-z]:[/\\]+Users[/\\]+[^/\\'"<>\s]+(?:[/\\]|$)/i,
  },
  {
    name: 'home file URI',
    pattern:
      /file:(?:\/{1,3}|\\{2,})(?:[A-Za-z]:[/\\]+)?(?:Users|home)[/\\]+[^/\\'"<>\s]+(?:[/\\]|$)/i,
  },
  {
    name: 'macOS per-user temporary directory',
    pattern: /\/(?:private\/)?var\/folders\//i,
  },
  {
    name: 'POSIX temporary directory',
    pattern: /\/(?:private\/)?tmp\//i,
  },
  {
    name: 'Windows temporary directory',
    // WHY: the scrubbed corpus keeps <user>\\AppData\\Local\\Temp diff headers, which hold no private name.
    pattern: /(?<!<user>[/\\]+AppData[/\\]*(?:Local[/\\]*)?)[/\\]+(?:Local[/\\]+)?Temp[/\\]/i,
  },
  {
    name: 'mounted user cloud drive',
    pattern: /\/Volumes\/(?:GoogleDrive|OneDrive)(?:[/\\]|$)/i,
  },
  {
    name: 'Windows mapped user drive',
    pattern: /[A-Za-z]:[/\\](?:My Drive|OneDrive)(?:[/\\]|$)/i,
  },
  {
    name: 'absolute donor connection path',
    pattern: /\b(?:directory|dbname|filename)=(['"])(?:\/|[A-Za-z]:|file:)[^'"]*\1/i,
  },
] as const;

const privatePathFixtures = [
  ['Windows drive user home', String.raw`C:\\\\Users\\\\DEVELO~1\\\\AppData`],
  ['Windows drive user home', String.raw`C:\\Users\\DEVELO~1\\AppData`],
  ['macOS user home', "dbname='/Users/developer/workbook.hyper'"],
  ['POSIX user home', "dbname='/home/developer/workbook.hyper'"],
  ['Windows drive user home', String.raw`dbname='C:\Users\developer\workbook.hyper'`],
  ['home file URI', "dbname='file:///Users/developer/workbook.hyper'"],
  ['home file URI', "dbname='file:///C:/Users/developer/workbook.hyper'"],
  ['macOS per-user temporary directory', "dbname='/private/var/folders/ab/session/workbook.hyper'"],
  ['POSIX temporary directory', "dbname='/tmp/session/workbook.hyper'"],
  ['Windows temporary directory', String.raw`AppData\\Local\\Temp\\2\\tmpabc.xml`],
  ['mounted user cloud drive', "dbname='/Volumes/GoogleDrive/My Drive/workbook.hyper'"],
  ['Windows mapped user drive', "dbname='G:/My Drive/workbook.hyper'"],
  ['absolute donor connection path', "dbname='D:/developer-assets/workbook.hyper'"],
] as const;

const anonymizedPathFixtures = [
  'C:/Users/<user>/Downloads',
  String.raw`C:\\\\Users\\\\<user>\\\\AppData`,
  String.raw`C:\\\\Users\\\\<user>\\\\AppData\\\\Local\\\\Temp\\\\2\\\\tmpabc.xml`,
] as const;

const templateOnlyRules = new Set(['absolute donor connection path']);

describe('bundled bookmark privacy', () => {
  it.each(privatePathFixtures)('detects %s', (name, contents) => {
    const rule = privatePathPatterns.find((candidate) => candidate.name === name);
    if (!rule) throw new Error(`Missing private-path rule: ${name}`);
    expect(rule.pattern.test(contents)).toBe(true);
  });

  it.each(anonymizedPathFixtures)('accepts anonymized path %s', (contents) => {
    expect(privatePathPatterns.some(({ pattern }) => pattern.test(contents))).toBe(false);
  });

  it('contains no absolute developer or user paths', () => {
    const templateFiles = readdirSync(bundledTemplatesDirectory)
      .filter((name) => name.endsWith('.tbm'))
      .sort();
    const violations: string[] = [];

    for (const templateFile of templateFiles) {
      const contents = readFileSync(join(bundledTemplatesDirectory, templateFile), 'utf8');
      for (const { name, pattern } of privatePathPatterns) {
        if (pattern.test(contents)) violations.push(`${templateFile}: ${name}`);
      }
    }

    expect(templateFiles).toHaveLength(137);
    expect(violations).toEqual([]);
  });

  it('contains no private paths in any shipped desktop data file', () => {
    const files = shippedDataDirectories.flatMap((directory) =>
      readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name)),
    );
    const relativeFiles = files.map((file) => relative(process.cwd(), file).split(sep).join('/'));
    const violations: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const { name, pattern } of privatePathPatterns) {
        if (templateOnlyRules.has(name)) continue;
        if (pattern.test(contents)) violations.push(`${relative(process.cwd(), file)}: ${name}`);
      }
    }

    expect(files.length).toBeGreaterThanOrEqual(150);
    for (const root of shippedDataRoots) {
      expect(relativeFiles.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
    expect(relativeFiles).toContain('src/desktop/data/corpus.json');
    expect(violations).toEqual([]);
  });
});
