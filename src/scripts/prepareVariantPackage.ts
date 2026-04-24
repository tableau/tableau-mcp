import { existsSync } from 'fs';
import { copyFile, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

import { isVariant, Variant, variants } from './variants';

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const packageJsonPath = join(repoRoot, 'package.json');

const variant = process.argv.includes('--variant')
  ? process.argv[process.argv.indexOf('--variant') + 1]
  : 'default';

if (!isVariant(variant)) {
  throw new Error(`Invalid build variant: ${variant}. Expected one of: ${variants.join(', ')}`);
}

if (variant === 'default') {
  throw new Error('The default variant needs no preparation');
}

type PackageVariant = Exclude<Variant, 'default'>;
const variantPackageJsonOverrides = {
  desktop: {
    name: '@tableau/desktop-mcp-server',
    description:
      'MCP server for Tableau Desktop Agent API - enables AI agents to interact with Tableau workbooks',
    bin: {
      'tableau-desktop-mcp-server': './build/index-desktop.js',
    },
    exports: {
      '.': './build/index-desktop.js',
    },
  },
} satisfies Record<PackageVariant, Partial<PackageJson>>;

const packageJsonSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    bin: z.record(z.string()),
    exports: z.record(z.string()),
  })
  .passthrough();

type PackageJson = z.infer<typeof packageJsonSchema>;

(async () => {
  const overrides = variantPackageJsonOverrides[variant];
  const packageJson = { ...(await readPackageJson()), ...overrides };
  await writePackageJson(packageJson);

  if (existsSync(join(repoRoot, `README.${variant}.md`))) {
    await copyFile(join(repoRoot, `README.${variant}.md`), join(repoRoot, 'README.md'));
  }
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function readPackageJson(): Promise<PackageJson> {
  const raw = await readFile(packageJsonPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return packageJsonSchema.parse(parsed);
}

async function writePackageJson(data: PackageJson): Promise<void> {
  await writeFile(packageJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
