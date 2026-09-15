/* eslint-disable no-console */

/**
 * Builds the deterministic scaffold-data-app template zip and writes it to disk.
 *
 * Produces the byte-stable STORE zip (top-level `Data App Name/` folder) that is published to S3
 * out of band and presigned by the http (remote) transport (see `dataAppWorkspaceStore.ts`).
 * Publishing the artifact is a separate, external step — this script only builds it.
 *
 * Usage:
 *   npm run build:data-app-template            # writes build/data-app-template.zip
 *   npm run build:data-app-template -- <path>  # writes to <path>
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

import { TEMPLATE_ROOT_DIRNAME } from '../tools/web/scaffoldDataApp/templateIdentity.js';
import { buildTemplateZip } from '../tools/web/scaffoldDataApp/templateZip.js';

const TEMPLATES_DIR = resolve(process.cwd(), 'src/templates');
const DEFAULT_OUTPUT = resolve(process.cwd(), 'build', 'data-app-template.zip');

(async (): Promise<void> => {
  const outputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const templateRoot = join(TEMPLATES_DIR, TEMPLATE_ROOT_DIRNAME);

  console.log(`🏗️ Building deterministic template zip from ${templateRoot}...`);
  const zip = await buildTemplateZip(templateRoot);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, zip);
  console.log(`✅ Wrote ${zip.length} bytes to ${outputPath}`);
})().catch((error) => {
  console.error('❌ Failed to build data app template zip:', error);
  process.exit(1);
});
