import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

function pullRequestPaths(): string[] {
  const lines = readFileSync(join(ROOT, '.github/workflows/upload-binaries.yml'), 'utf-8').split(
    '\n',
  );
  const start = lines.findIndex((line) => /^ {4}paths:/.test(line));
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^ {6}- (.+)$/.exec(line);
    if (!match) break;
    paths.push(match[1].trim());
  }
  return paths;
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${source}$`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('upload-binaries workflow path filter', () => {
  it('lists the paths filter', () => {
    expect(pullRequestPaths()).toContain('src/utils/sea.ts');
  });

  it('covers every source file that reads embedded SEA assets', () => {
    const patterns = pullRequestPaths().map(globToRegExp);
    const uncovered = sourceFiles(SRC)
      .filter((file) =>
        /from '(?:\.{1,2}\/)+(?:utils\/)?sea\.js'/.test(readFileSync(file, 'utf-8')),
      )
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .filter((file) => !patterns.some((pattern) => pattern.test(file)));

    expect(uncovered).toEqual([]);
  });
});
