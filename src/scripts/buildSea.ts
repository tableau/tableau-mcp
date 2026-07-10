/* eslint-disable no-console */

import { spawnSync } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { chmod, cp, mkdir, readdir, rm, writeFile } from 'fs/promises';
import { dirname, join, posix, relative, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { fileURLToPath } from 'url';

// @ts-expect-error - import.meta is not allowed in CommonJS output, this script is run with tsx as ESM
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

type SeaVariant = {
  buildVariant: string;
  entry: string;
  binaryBase: string;
  // Build-relative directories whose files are embedded into the SEA blob as
  // assets. The desktop server reads these at runtime via node:sea so the
  // binary is fully self-contained; the default (web) server needs none.
  assetDirs: readonly string[];
};

const seaVariants = {
  default: {
    buildVariant: 'default',
    entry: 'build/index.js',
    binaryBase: 'tableau-mcp',
    assetDirs: [],
  },
  desktop: {
    buildVariant: 'desktop',
    entry: 'build/index.desktop.js',
    binaryBase: 'tableau-mcp-desktop',
    assetDirs: ['resources/desktop', 'desktop/data'],
  },
} as const satisfies Record<string, SeaVariant>;

const MANIFEST_KEY = 'asset-manifest.json';

type VariantKey = keyof typeof seaVariants;

function isVariantKey(value: string): value is VariantKey {
  return value in seaVariants;
}

type SeaPlatform = {
  arch: string;
  os: 'darwin' | 'linux' | 'win';
  exeSuffix: string;
  machoSegment: boolean;
};

const platforms = {
  'macos-arm64': { arch: 'arm64', os: 'darwin', exeSuffix: '', machoSegment: true },
  'macos-x64': { arch: 'x64', os: 'darwin', exeSuffix: '', machoSegment: true },
  'linux-x64': { arch: 'x64', os: 'linux', exeSuffix: '', machoSegment: false },
  'linux-arm64': { arch: 'arm64', os: 'linux', exeSuffix: '', machoSegment: false },
  'win-x64': { arch: 'x64', os: 'win', exeSuffix: '.exe', machoSegment: false },
} as const satisfies Record<string, SeaPlatform>;

type PlatformKey = keyof typeof platforms;

function isPlatformKey(value: string): value is PlatformKey {
  return value in platforms;
}

function hostPlatformKey(): PlatformKey {
  const os =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const key = `${os === 'darwin' ? 'macos' : os}-${arch}`;
  if (!isPlatformKey(key)) {
    throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`);
  }
  return key;
}

function parseListArg(flag: string): string[] | undefined {
  if (!process.argv.includes(flag)) {
    return undefined;
  }
  const values: string[] = [];
  for (const arg of process.argv.slice(process.argv.indexOf(flag) + 1)) {
    if (arg.startsWith('--')) {
      break;
    }
    values.push(arg);
  }
  return values;
}

const skipBuild = process.argv.includes('--skip-build');

const requestedVariants =
  parseListArg('--variant') ?? (['default', 'desktop'] satisfies VariantKey[]);
for (const v of requestedVariants) {
  if (!isVariantKey(v)) {
    throw new Error(
      `Invalid variant: ${v}. Expected one of: ${Object.keys(seaVariants).join(', ')}`,
    );
  }
}

const requestedPlatforms = parseListArg('--platform') ?? [hostPlatformKey()];
for (const p of requestedPlatforms) {
  if (!isPlatformKey(p)) {
    throw new Error(
      `Invalid platform: ${p}. Expected one of: ${Object.keys(platforms).join(', ')}`,
    );
  }
}

function run(command: string, args: string[], cwd = repoRoot): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
}

async function downloadNodeDist(platform: SeaPlatform, downloadDir: string): Promise<string> {
  const version = process.version;
  const distName =
    platform.os === 'win'
      ? `node-${version}-win-${platform.arch}`
      : `node-${version}-${platform.os}-${platform.arch}`;
  const archiveExt = platform.os === 'win' ? 'zip' : 'tar.gz';
  const archivePath = join(downloadDir, `${distName}.${archiveExt}`);
  const distDir = join(downloadDir, distName);

  if (!existsSync(distDir)) {
    if (!existsSync(archivePath)) {
      const url = `https://nodejs.org/dist/${version}/${distName}.${archiveExt}`;
      console.log(`⬇️  Downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
      }
      await pipeline(
        Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
        createWriteStream(archivePath),
      );
    }
    console.log(`📦 Extracting ${distName}`);
    if (platform.os === 'win') {
      run('unzip', ['-oq', archivePath, '-d', downloadDir]);
    } else {
      run('tar', ['-xzf', archivePath, '-C', downloadDir]);
    }
  }

  const nodeBinary =
    platform.os === 'win' ? join(distDir, 'node.exe') : join(distDir, 'bin', 'node');
  if (!existsSync(nodeBinary)) {
    throw new Error(`node binary not found after extraction: ${nodeBinary}`);
  }
  return nodeBinary;
}

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

// Builds the SEA assets map for a variant: every file under its assetDirs keyed
// by its build-relative forward-slash path, plus a manifest listing those keys
// (so the runtime can enumerate directory contents, which node:sea can't).
async function buildAssetsMap(variant: SeaVariant): Promise<{
  assets: Record<string, string>;
  manifestPath: string | null;
}> {
  if (variant.assetDirs.length === 0) {
    return { assets: {}, manifestPath: null };
  }
  const buildDir = join(repoRoot, 'build');
  const assets: Record<string, string> = {};
  for (const assetDir of variant.assetDirs) {
    const absDir = join(buildDir, ...assetDir.split('/'));
    if (!existsSync(absDir)) {
      throw new Error(`Asset directory missing: build/${assetDir}. Run the build first.`);
    }
    for (const file of await walkFiles(absDir)) {
      const key = relative(buildDir, file).split(sep).join(posix.sep);
      assets[key] = file;
    }
  }
  const manifestPath = join(repoRoot, `asset-manifest.${variant.buildVariant}.generated.json`);
  await writeFile(manifestPath, JSON.stringify(Object.keys(assets).sort(), null, 2));
  assets[MANIFEST_KEY] = manifestPath;
  return { assets, manifestPath };
}

async function generateBlob(variant: SeaVariant): Promise<string> {
  if (!existsSync(join(repoRoot, variant.entry))) {
    throw new Error(
      `Entry point missing: ${variant.entry}. Run the build first (omit --skip-build).`,
    );
  }
  const blobPath = join(repoRoot, `sea-prep.${variant.buildVariant}.blob`);
  const configPath = join(repoRoot, `sea-config.${variant.buildVariant}.generated.json`);
  const { assets, manifestPath } = await buildAssetsMap(variant);
  const config: Record<string, unknown> = {
    main: variant.entry,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  };
  if (Object.keys(assets).length > 0) {
    config.assets = assets;
  }
  await writeFile(configPath, JSON.stringify(config, null, 2));
  try {
    run('node', ['--experimental-sea-config', configPath]);
  } finally {
    await rm(configPath, { force: true });
    if (manifestPath) {
      await rm(manifestPath, { force: true });
    }
  }
  if (!existsSync(blobPath)) {
    throw new Error(`SEA blob was not generated for variant ${variant.buildVariant}`);
  }
  return blobPath;
}

async function buildBinary(
  variantKey: VariantKey,
  platformKey: PlatformKey,
  blobPath: string,
  downloadDir: string,
): Promise<void> {
  const variant = seaVariants[variantKey];
  const platform = platforms[platformKey];
  const outDir = join(repoRoot, 'build', 'sea', variantKey, platformKey);
  const outBinary = join(outDir, `${variant.binaryBase}${platform.exeSuffix}`);

  // Official Node distributions embed the SEA fuse sentinel that postject needs;
  // a package-manager node (e.g. Homebrew) does not, so we always inject into a
  // freshly downloaded official binary rather than process.execPath.
  const sourceNode = await downloadNodeDist(platform, downloadDir);

  await mkdir(outDir, { recursive: true });
  await rm(outBinary, { force: true });
  await cp(sourceNode, outBinary);
  await chmod(outBinary, 0o755);

  if (platform.os === 'darwin' && process.platform === 'darwin') {
    run('codesign', ['--remove-signature', outBinary]);
  }

  const postjectArgs = [
    '-y',
    'postject',
    outBinary,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SENTINEL_FUSE,
  ];
  if (platform.machoSegment) {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  run('npx', postjectArgs);

  if (platform.os === 'darwin' && process.platform === 'darwin') {
    run('codesign', ['--sign', '-', outBinary]);
  } else if (platform.os === 'darwin') {
    console.log('⚠️  Skipping codesign: macOS binaries must be signed on a macOS host before use.');
  }

  console.log(`✅ ${variantKey}/${platformKey}: ${outBinary}`);
}

(async () => {
  const variantKeys = requestedVariants as VariantKey[];
  const platformKeys = requestedPlatforms as PlatformKey[];

  if (!skipBuild) {
    // The variant build clears ./build unless --dirty, so the first build runs
    // clean and the rest preserve earlier variants' entry points.
    variantKeys.forEach((variantKey, index) => {
      const variant = seaVariants[variantKey];
      console.log(`🏗️ Building ${variantKey} variant...`);
      const args = ['tsx', 'src/scripts/build.ts', '--variant', variant.buildVariant];
      if (index > 0) {
        args.push('--dirty');
      }
      run('npx', args);
    });
  }

  const downloadDir = join(repoRoot, 'build', 'sea', '_dl');
  await mkdir(downloadDir, { recursive: true });
  const blobs: string[] = [];

  for (const variantKey of variantKeys) {
    console.log(`\n🧬 Generating SEA blob for ${variantKey}...`);
    const blobPath = await generateBlob(seaVariants[variantKey]);
    blobs.push(blobPath);
    for (const platformKey of platformKeys) {
      console.log(`🚀 Building SEA binary for ${variantKey}/${platformKey}...`);
      await buildBinary(variantKey, platformKey, blobPath, downloadDir);
    }
  }

  await Promise.all(blobs.map((blob) => rm(blob, { force: true })));
  await rm(downloadDir, { recursive: true, force: true });

  console.log('\n🎉 Done. Binaries under build/sea/<variant>/<platform>/');
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
