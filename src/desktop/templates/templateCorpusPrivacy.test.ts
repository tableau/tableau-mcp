import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundledTemplatesDirectory = join(process.cwd(), 'src/desktop/data/templates');

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
    pattern: /[A-Za-z]:[/\\]Users[/\\][^/\\'"<>\s]+(?:[/\\]|$)/i,
  },
  {
    name: 'home file URI',
    pattern:
      /file:(?:\/{1,3}|\\{2,3})(?:[A-Za-z]:[/\\])?(?:Users|home)[/\\][^/\\'"<>\s]+(?:[/\\]|$)/i,
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
  ['macOS user home', "dbname='/Users/developer/workbook.hyper'"],
  ['POSIX user home', "dbname='/home/developer/workbook.hyper'"],
  ['Windows drive user home', String.raw`dbname='C:\Users\developer\workbook.hyper'`],
  ['home file URI', "dbname='file:///Users/developer/workbook.hyper'"],
  ['home file URI', "dbname='file:///C:/Users/developer/workbook.hyper'"],
  ['macOS per-user temporary directory', "dbname='/private/var/folders/ab/session/workbook.hyper'"],
  ['POSIX temporary directory', "dbname='/tmp/session/workbook.hyper'"],
  ['mounted user cloud drive', "dbname='/Volumes/GoogleDrive/My Drive/workbook.hyper'"],
  ['Windows mapped user drive', "dbname='G:/My Drive/workbook.hyper'"],
  ['absolute donor connection path', "dbname='D:/developer-assets/workbook.hyper'"],
] as const;

describe('bundled bookmark privacy', () => {
  it.each(privatePathFixtures)('detects %s', (name, contents) => {
    const rule = privatePathPatterns.find((candidate) => candidate.name === name);
    if (!rule) throw new Error(`Missing private-path rule: ${name}`);
    expect(rule.pattern.test(contents)).toBe(true);
  });

  it('contains no absolute developer or user paths', () => {
    const templateFiles = readdirSync(bundledTemplatesDirectory)
      .filter((name) => name.endsWith('.tbm'))
      .sort();
    const violations: string[] = [];

    for (const templateFile of templateFiles) {
      const contents = readFileSync(join(bundledTemplatesDirectory, templateFile), 'utf8');
      for (const { name, pattern } of privatePathPatterns) {
        const match = contents.match(pattern);
        if (match) violations.push(`${templateFile}: ${name}: ${match[0]}`);
      }
    }

    expect(templateFiles).toHaveLength(133);
    expect(violations).toEqual([]);
  });
});
