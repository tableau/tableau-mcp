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
import { createWriteStream, existsSync, rmSync } from 'fs';
import { resolve } from 'path';

export const TEMPLATE_ZIP_FILENAME = 'data-app-template.zip';

export async function buildTemplateZip(): Promise<string> {
  const templatesDir = resolve(process.cwd(), 'src/templates');
  const zipPath = resolve(templatesDir, TEMPLATE_ZIP_FILENAME);

  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    // Mirror `zip -rXq TEMPLATE_ZIP_FILENAME 'Data App Name'`: recursively archive the template
    // directory with `Data App Name` as the zip's root entry (not just its contents).
    const archive = new ZipArchive();

    // Resolve only once the file is fully flushed to disk, so callers that immediately read the
    // zip (build copy step, tests) never race a partially-written file.
    output.on('close', () => resolvePromise());
    output.on('error', reject);
    archive.on('error', reject);
    // Warnings (e.g. ENOENT/stat) that archiver would otherwise swallow should fail the build.
    archive.on('warning', reject);

    archive.pipe(output);
    // `zip -rX` emits an explicit entry for the top-level `Data App Name/` directory itself;
    // archiver's directory() only emits the descendants, so add the root entry to match exactly.
    archive.append(Buffer.alloc(0), { name: 'Data App Name/' });
    archive.directory(resolve(templatesDir, 'Data App Name'), 'Data App Name');
    void archive.finalize();
  });

  return zipPath;
}

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  buildTemplateZip().then((path) => console.log(`✅ Built ${path}`));
}
