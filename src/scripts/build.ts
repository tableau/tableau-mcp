/* eslint-disable no-console */

import { build, BuildOptions } from 'esbuild';
import { chmod, copyFile, cp, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { GlobalIdentifierName, globalIdentifiers } from './globalIdentifiers.js';
import { isVariant, variants } from './variants.js';

const dev = process.argv.includes('--dev');
const dirty = process.argv.includes('--dirty');
const variant = process.argv.includes('--variant')
  ? process.argv[process.argv.indexOf('--variant') + 1]
  : 'default';

if (!isVariant(variant)) {
  throw new Error(`Invalid variant: ${variant}. Expected one of: ${variants.join(', ')}`);
}

const globalValues: Record<GlobalIdentifierName, string> = {
  BUILD_VARIANT: variant,
};

(async () => {
  if (!dirty) {
    await rm('./build', { recursive: true, force: true });
  }

  console.log(`🏗️ Building ${variant} variant...`);
  const buildOptions: BuildOptions = {
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: !dev,
    packages: dev ? 'external' : 'bundle',
    sourcemap: true,
    logLevel: dev ? 'debug' : 'info',
    logOverride: {
      'empty-import-meta': 'silent',
    },
    outfile: './build/index.js',
    // must be last so that the action can override previous build options
    ...globalIdentifiers.reduce((acc, { name, defaultValue, action }) => {
      return { ...acc, ...action(globalValues[name] ?? defaultValue) };
    }, {}),
  };

  if (!buildOptions.outfile) {
    throw new Error('outfile build option must be specified');
  }

  const result = await build(buildOptions);

  for (const error of result.errors) {
    console.log(`❌ ${error.text}`);
  }

  for (const warning of result.warnings) {
    console.log(`⚠️ ${warning.text}`);
  }

  console.log('🏗️ Building telemetry/tracing.js...');
  await mkdir('./build/telemetry', { recursive: true });
  const tracingResult = await build({
    entryPoints: ['./src/telemetry/tracing.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: !dev,
    packages: 'external',
    sourcemap: true,
    outfile: './build/telemetry/tracing.js',
  });

  for (const error of tracingResult.errors) {
    console.log(`❌ ${error.text}`);
  }

  for (const warning of tracingResult.warnings) {
    console.log(`⚠️ ${warning.text}`);
  }

  await chmod(buildOptions.outfile, '755');

  // Stage the bundled authoring data (template manifests + generated index/content
  // manifest, template XML, and the desktop reference corpora) into the build output.
  // esbuild bundles CODE only — these are read at runtime via fs, so a published /
  // npm-installed server has no data unless we copy them. The target path matches the
  // package-relative `build/desktop/data` layout that manifest.ts resolveDataDir()
  // probes as candidate 2 (`__dirname/desktop/data`, where __dirname === build/).
  console.log('🏗️ Staging desktop data...');
  await cp('./src/desktop/data', './build/desktop/data', { recursive: true });
  console.log('✅ Desktop data staged to build/desktop/data');

  console.log('🏗️ Building MCP Apps...');
  try {
    const appsDir = resolve(process.cwd(), 'src/web/apps');
    await viteBuild({
      configFile: false, // Don't load vite.config.ts
      root: appsDir,
      plugins: [viteSingleFile()],
      resolve: {
        alias: {
          '~': resolve(process.cwd()),
        },
      },
      build: {
        sourcemap: dev ? 'inline' : undefined,
        cssMinify: !dev,
        minify: !dev,
        rollupOptions: {
          input: resolve(appsDir, 'mcp-app.html'),
        },
        outDir: resolve(appsDir, 'dist'),
        emptyOutDir: false,
      },
    });

    // Copy built HTML to build directory
    const buildWebApps = './build/web/apps/dist';
    await mkdir(buildWebApps, { recursive: true });
    await copyFile(
      resolve(appsDir, 'dist/mcp-app.html'),
      resolve(process.cwd(), buildWebApps, 'mcp-app.html'),
    );

    console.log('✅ MCP Apps built successfully');
  } catch (error) {
    console.error('❌ Failed to build MCP Apps:', error);
    process.exit(1);
  }
})();
