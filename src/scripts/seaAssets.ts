import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, posix, relative, sep } from 'path';
import { fileURLToPath } from 'url';

// @ts-expect-error - import.meta is not allowed in CommonJS output, this module is run with tsx as ESM
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

export const MANIFEST_KEY = 'asset-manifest.json';

export const DESKTOP_ASSET_DIRS: readonly string[] = ['resources/desktop', 'desktop/data'];

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export async function buildAssetsMap(
  assetDirs: readonly string[],
  buildVariant: string,
): Promise<{
  assets: Record<string, string>;
  manifestPath: string | null;
}> {
  if (assetDirs.length === 0) {
    return { assets: {}, manifestPath: null };
  }
  const buildDir = join(repoRoot, 'build');
  const assets: Record<string, string> = {};
  for (const assetDir of assetDirs) {
    const absDir = join(buildDir, ...assetDir.split('/'));
    if (!existsSync(absDir)) {
      throw new Error(`Asset directory missing: build/${assetDir}. Run the build first.`);
    }
    for (const file of await walkFiles(absDir)) {
      const key = relative(buildDir, file).split(sep).join(posix.sep);
      assets[key] = file;
    }
  }
  const manifest: Record<string, { sha256: string; bytes: number }> = {};
  for (const key of Object.keys(assets).sort()) {
    const buf = await readFile(assets[key]);
    manifest[key] = {
      sha256: createHash('sha256').update(buf).digest('hex'),
      bytes: buf.byteLength,
    };
  }
  const manifestPath = join(repoRoot, `asset-manifest.${buildVariant}.generated.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  assets[MANIFEST_KEY] = manifestPath;
  return { assets, manifestPath };
}
