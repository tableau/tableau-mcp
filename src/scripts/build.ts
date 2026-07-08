/* eslint-disable no-console */

import { build, BuildOptions } from 'esbuild';
import { chmod, copyFile, mkdir, rm } from 'fs/promises';
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

  console.log('🏗️ Copying features.json to build directory...');
  await copyFile(
    resolve(process.cwd(), 'features.json'),
    resolve(process.cwd(), 'build', 'features.json'),
  );
  console.log('✅ features.json copied successfully');

  console.log('🏗️ Building MCP Apps...');
  try {
    const appsDir = resolve(process.cwd(), 'src/web/apps');

    // Each entry is a self-contained, single-file HTML bundled by functionality:
    // - mcp-app.html: embeds a Tableau viz (get-view / get-workbook).
    // - hitl-confirm.html: the MCP-Apps HITL confirm panel for delete/update preview tools.
    // viteSingleFile inlines all JS/CSS into one HTML per rollup input; to guarantee both outputs
    // are fully inlined (a single multi-input build does not reliably inline every entry), build
    // each entry with its own viteBuild call. emptyOutDir:false lets them share the dist directory.
    const htmlEntries = ['mcp-app.html', 'hitl-confirm.html'];

    for (const htmlEntry of htmlEntries) {
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
            input: resolve(appsDir, htmlEntry),
          },
          outDir: resolve(appsDir, 'dist'),
          emptyOutDir: false,
        },
      });
    }

    // Copy each built HTML to the build directory.
    const buildWebApps = './build/web/apps/dist';
    await mkdir(buildWebApps, { recursive: true });
    for (const htmlEntry of htmlEntries) {
      await copyFile(
        resolve(appsDir, 'dist', htmlEntry),
        resolve(process.cwd(), buildWebApps, htmlEntry),
      );
    }

    console.log('✅ MCP Apps built successfully');
  } catch (error) {
    console.error('❌ Failed to build MCP Apps:', error);
    process.exit(1);
  }
})();
