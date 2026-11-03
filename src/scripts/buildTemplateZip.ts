/**
 * Regenerates the static, un-substituted `scaffold-data-app` template zip from the committed
 * template tree (`src/templates/Data App Name/`). Both local (stdio) and S3 output modes serve
 * this same zip verbatim; it is never committed and is always rebuilt so it can't drift from the
 * template tree.
 *
 * Uses the pure-Node `archiver` library rather than shelling out to the `zip` CLI so the build
 * (and the `pretest` hook that invokes this) works identically on Windows, macOS and Linux with no
 * external binary on PATH — the Windows SEA build (`build-windows` job) has no `zip`.
 */

import { ZipArchive } from 'archiver';
import { randomUUID } from 'crypto';
import { createWriteStream, statSync, WriteStream } from 'fs';
import { copyFile, rename, rm } from 'fs/promises';
import { dirname, join, resolve } from 'path';

export const TEMPLATE_ZIP_FILENAME = 'data-app-template.zip';

// Temp name ends in `.zip` so the existing gitignore rule covers any leftover.
function tempZipPath(finalPath: string): string {
  return join(dirname(finalPath), `data-app-template.${process.pid}.${randomUUID()}.tmp.zip`);
}

// Readers of `destPath` see either the old file or the complete new one, never a partial write.
export async function copyFileAtomically(srcPath: string, destPath: string): Promise<void> {
  const tempPath = tempZipPath(destPath);
  try {
    await copyFile(srcPath, tempPath);
    await rename(tempPath, destPath);
  } catch (e) {
    await discardTempFile(tempPath);
    throw e;
  }
}

// Best-effort: the stream's async open can create the file after a failure, so close it first.
async function discardTempFile(tempPath: string, output?: WriteStream): Promise<void> {
  try {
    if (output && !output.closed) {
      await new Promise<void>((done) => {
        output.once('close', () => done());
        output.destroy();
      });
    }
    await rm(tempPath, { force: true });
  } catch {
    // The original build error is the one worth surfacing.
  }
}

export async function buildTemplateZip(): Promise<string> {
  const templatesDir = resolve(process.cwd(), 'src/templates');
  const zipPath = resolve(templatesDir, TEMPLATE_ZIP_FILENAME);

  const rootDir = resolve(templatesDir, 'Data App Name');
  const tempPath = tempZipPath(zipPath);
  // Read before opening the output so a missing template tree throws before any temp file exists.
  const rootMtime = statSync(rootDir).mtime;
  let output: WriteStream | undefined;

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const out = createWriteStream(tempPath);
      output = out;
      // Mirror `zip -rXq TEMPLATE_ZIP_FILENAME 'Data App Name'`: recursively archive the template
      // directory with `Data App Name` as the zip's root entry (not just its contents).
      const archive = new ZipArchive();

      // Resolve only once the file is fully flushed to disk, so callers that immediately read the
      // zip (build copy step, tests) never race a partially-written file.
      out.on('close', () => resolvePromise());
      out.on('error', reject);
      archive.on('error', reject);
      // Warnings (e.g. ENOENT/stat) that archiver would otherwise swallow should fail the build.
      archive.on('warning', reject);

      archive.pipe(out);
      // `zip -rX` emits an explicit entry for the top-level `Data App Name/` directory itself;
      // archiver's directory() only emits the descendants, so add the root entry to match exactly.
      // The pinned date keeps the zip byte-identical across builds (archiver defaults to now).
      archive.append(Buffer.alloc(0), { name: 'Data App Name/', date: rootMtime });
      archive.directory(rootDir, 'Data App Name');
      void archive.finalize();
    });
    await rename(tempPath, zipPath);
  } catch (e) {
    await discardTempFile(tempPath, output);
    throw e;
  }

  return zipPath;
}

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  buildTemplateZip().then((path) => console.log(`✅ Built ${path}`));
}
