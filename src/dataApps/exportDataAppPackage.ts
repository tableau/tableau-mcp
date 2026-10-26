import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { lstat, mkdir, readdir, readFile } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';
import { Err, Ok, Result } from 'ts-results-es';

import { McpToolError } from '../errors/mcpToolError.js';

const INCLUDED_ROOTS = new Set(['manifest.json', 'extensions', 'content']);

export type ExportedDataApp = {
  filePath: string;
  packageId: string;
  version: string;
};

type PackageFile = { archiveName: string; bytes: Buffer };

async function collectPackageFiles(packageDir: string): Promise<PackageFile[]> {
  const files: PackageFile[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.endsWith('~') || entry.name.endsWith('.tmp')) {
        continue;
      }
      const full = join(directory, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to archive a symlink: ${full}`);
      }
      const archiveName = relative(packageDir, full).split(sep).join('/');
      if (archiveName.split('/').some((part) => part === '..' || part === '')) {
        throw new Error(`Refusing an unsafe archive path: ${archiveName}`);
      }
      const top = archiveName.split('/')[0];
      if (!INCLUDED_ROOTS.has(top)) {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Refusing to archive a non-file: ${full}`);
      }
      files.push({ archiveName, bytes: await readFile(full) });
    }
  };
  await walk(packageDir);
  return files;
}

function manifestIdentity(files: PackageFile[]): { packageId: string; version: string } {
  const manifest = files.find((file) => file.archiveName === 'manifest.json');
  if (!manifest) {
    throw new Error('Package is missing manifest.json.');
  }
  const parsed = JSON.parse(manifest.bytes.toString('utf8')) as {
    id?: unknown;
    version?: unknown;
    name?: unknown;
  };
  if (
    typeof parsed.id !== 'string' ||
    !parsed.id ||
    typeof parsed.version !== 'string' ||
    !parsed.version
  ) {
    throw new Error('manifest.json must include string id and version.');
  }
  if (typeof parsed.name !== 'string' || !parsed.name) {
    throw new Error('manifest.json must include a name.');
  }
  const trex = files.some(
    (file) => file.archiveName.startsWith('extensions/') && file.archiveName.endsWith('.trex'),
  );
  if (!trex) {
    throw new Error('Package is missing an extensions/*.trex manifest.');
  }
  const library = files.some((file) => file.archiveName.includes('tableau.extensions.'));
  if (!library) {
    throw new Error('Package is missing the Extensions client library.');
  }
  const trexText = files
    .filter((file) => file.archiveName.endsWith('.trex'))
    .map((file) => file.bytes.toString('utf8'))
    .join('\n');
  if (trexText.includes('..') || /https?:\/\//.test(trexText)) {
    const urlMatch = trexText.match(/<url>([^<]*)<\/url>/);
    if (
      urlMatch &&
      (urlMatch[1].includes('..') ||
        /^https?:\/\//.test(urlMatch[1]) ||
        urlMatch[1].startsWith('/'))
    ) {
      throw new Error('Extension content URL must be a relative package path.');
    }
  }
  return { packageId: parsed.id, version: parsed.version };
}

async function writeZip(filePath: string, files: PackageFile[]): Promise<void> {
  await new Promise<void>((done, reject) => {
    const output = createWriteStream(filePath);
    const archive = new ZipArchive();
    output.on('close', () => done());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.append(file.bytes, { name: file.archiveName });
    }
    void archive.finalize();
  });
}

export async function exportDataAppPackage(args: {
  packageDir: string;
  exportsDir: string;
}): Promise<Result<ExportedDataApp, McpToolError>> {
  try {
    const packageDir = resolve(args.packageDir);
    const stat = await lstat(packageDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Package path must be a real directory.');
    }
    const files = await collectPackageFiles(packageDir);
    const identity = manifestIdentity(files);
    const exportsDir = resolve(args.exportsDir);
    await mkdir(exportsDir, { recursive: true });
    const fileName = `${identity.packageId}-${identity.version}.tpkg`.replace(/[\\/]/g, '_');
    const filePath = join(exportsDir, fileName);
    await writeZip(filePath, files);
    return new Ok({ filePath, packageId: identity.packageId, version: identity.version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Err(
      new McpToolError({
        type: 'data-app-export-rejected',
        message,
        statusCode: 400,
      }),
    );
  }
}
