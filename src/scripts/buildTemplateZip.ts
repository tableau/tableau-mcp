/**
 * Regenerates the static, un-substituted `scaffold-data-app` template zip from the committed
 * template tree (`src/templates/Data App Name/`). Both local (stdio) and S3 output modes serve
 * this same zip verbatim; it is never committed and is always rebuilt so it can't drift from the
 * template tree.
 */

import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';

export const TEMPLATE_ZIP_FILENAME = 'data-app-template.zip';

export function buildTemplateZip(): string {
  const templatesDir = resolve(process.cwd(), 'src/templates');
  const zipPath = resolve(templatesDir, TEMPLATE_ZIP_FILENAME);

  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  execFileSync('zip', ['-rXq', TEMPLATE_ZIP_FILENAME, 'Data App Name'], {
    cwd: templatesDir,
  });

  return zipPath;
}

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  console.log(`✅ Built ${buildTemplateZip()}`);
}
