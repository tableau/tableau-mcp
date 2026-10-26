import { constants } from 'fs';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'path';

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.trex', '.md', '.txt']);

export function replaceLiteral(text: string, find: string, replacement: string): string {
  return text.replaceAll(find, () => replacement);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unzippedPackageSrcUrl(absoluteDir: string): string {
  return `tableauunzippedpackagesrc:///${absoluteDir.replace(/\\/g, '/')}`;
}

export function isExtensionsLibrary(fileName: string): boolean {
  return fileName.startsWith('tableau.extensions.');
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot) : '';
}

export function containedPath(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '') {
    return resolvedTarget;
  }
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new Error(`Path escapes the package root: ${target}`);
  }
  return resolvedTarget;
}

export async function copyPackageTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to copy a symlink: ${source}`);
    }
    if (stat.isDirectory()) {
      await copyPackageTree(source, destination);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Refusing to copy a non-file: ${source}`);
    }
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}

export async function replaceTokensInTree(
  root: string,
  replace: (relativePath: string, text: string) => string,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to edit a symlink: ${full}`);
    }
    if (stat.isDirectory()) {
      await replaceTokensInTree(full, replace);
      continue;
    }
    if (
      !stat.isFile() ||
      isExtensionsLibrary(entry.name) ||
      !TEXT_EXTENSIONS.has(extensionOf(entry.name))
    ) {
      continue;
    }
    const text = await readFile(full, 'utf8');
    const next = replace(relative(root, full).replace(/\\/g, '/'), text);
    if (next !== text) {
      await writeFile(full, next, 'utf8');
    }
  }
}
