/* eslint-disable no-console */

import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

import { desktopPackageFiles } from './desktopNpmPackage.js';

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const packageDir = join(repoRoot, 'build-pkg', 'desktop');

const rootPackageJsonSchema = z.object({
  version: z.string(),
  license: z.string(),
  repository: z.unknown(),
  homepage: z.string(),
  engines: z.record(z.string(), z.string()),
});

(async () => {
  const rootPackageJson = rootPackageJsonSchema.parse(
    JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf-8')),
  );

  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const path of desktopPackageFiles) {
    await cp(join(repoRoot, path), join(packageDir, path), { recursive: true });
  }
  await cp(join(repoRoot, 'docs', 'README.desktop.md'), join(packageDir, 'README.md'));
  await cp(join(repoRoot, 'LICENSE.txt'), join(packageDir, 'LICENSE.txt'));

  const packageJson = {
    name: '@tableau/mcp-server-desktop',
    version: rootPackageJson.version,
    description: 'Tableau MCP server for Tableau Desktop, over the External Client API.',
    license: rootPackageJson.license,
    repository: rootPackageJson.repository,
    homepage: rootPackageJson.homepage,
    engines: rootPackageJson.engines,
    bin: { 'tableau-mcp-server-desktop': 'build/index.desktop.js' },
    files: [...desktopPackageFiles],
  };
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf-8',
  );

  console.log(`✅ Desktop npm package staged in ${packageDir}`);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
