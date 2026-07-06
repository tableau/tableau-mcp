/* eslint-disable no-console */

import { build, BuildOptions } from 'esbuild';
import { cpSync } from 'fs';
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
    ...globalIdentifiers.reduce((acc, { name, defaultValue, getBuildOptions }) => {
      return { ...acc, ...getBuildOptions(globalValues[name] ?? defaultValue) };
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

  if (variant === 'desktop' || variant === 'combined') {
    copyDirectory('./resources/desktop', './build/resources/desktop');
    copyDirectory('./src/desktop/data', './build/desktop/data');
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

  // Stage the bundled authoring data into the build output. esbuild bundles CODE
  // only — these files are read at runtime via fs, so a published / npm-installed
  // server has no data unless we copy them. The target `build/desktop/data` is the
  // path manifest.ts resolveDataDir() probes as candidate 2 (`__dirname/desktop/data`,
  // where __dirname === build/ in the bundle).
  //
  // EXPLICIT ALLOWLIST, not a blocklist (Lane M5 day-5 tarball scoping): copy only
  // the inputs a shipped tool reads THROUGH this package-relative path, so a large
  // asset can never silently ride into the npm tarball again. Every entry below is
  // resolved package-relative by manifest.ts (DATA_DIR) and feeds the binder core or
  // the BundledIntelligenceProvider — the surfaces behind bind-template / list-templates.
  //
  // DELIBERATELY EXCLUDED (verified day-5): twb-example-index.json (10.3 MB),
  // tableau-desktop-commands-reference.json (969 kB), workbook-schema-reference.json
  // (212 kB), corpus.json (178 kB), and examples/. Each IS read by a shipped search
  // tool (search-workbook-examples/search-examples/search-commands/lookup-workbook-schema),
  // but ONLY via a process.cwd()-relative path (searchLibrary.ts dataPath();
  // searchExamples/searchWorkbookExamples CORPUS_PATH) — NEVER __dirname/desktop/data.
  // A copy here is therefore consulted by no consumer: pure tarball weight. (Their
  // cwd-relative resolution also means they aren't reachable from a published install
  // at all — a separate resolution gap, tracked for a later lane, not fixed by staging.)
  // VARIANT-GATED: only the desktop tool surface (the `desktop` and `combined` variants)
  // ever resolves `build/desktop/data` at runtime (manifest.ts resolveDataDir candidate 2).
  // The `default` variant's server (src/index.ts) never reads it — and `default` is the
  // ONLY variant the publish pipeline builds — so staging it there is pure orphaned tarball
  // weight (~173 KB per install). Gate the staging on the variant so the default package
  // stays lean; desktop/combined still stage the full allowlist below.
  if (variant === 'desktop' || variant === 'combined') {
    console.log('🏗️ Staging desktop data (allowlist)...');
    const desktopDataSrc = './src/desktop/data';
    const desktopDataOut = './build/desktop/data';
    // LOCKSTEP: this allowlist is mirrored in
    // src/desktop/intelligence/content-manifest-staging.test.ts (STAGED_DESKTOP_DATA).
    // build.ts runs an IIFE at import (can't be imported without side effects), so the
    // test duplicates the list; keep the two in sync. That test also PROVES every
    // content-manifest.json resource lands under one of these roots.
    const stagedDesktopData = [
      'template-manifests', // MANIFESTS_DIR — loadManifests() (binder + provider)
      'template-manifests.index.json', // MANIFEST_INDEX_PATH — loadManifests()
      'template-manifests.fixture.json', // BINDER_FIXTURE_PATH — eligibility gate
      'content-manifest.json', // CONTENT_MANIFEST_PATH — provider.getStatus/getContentManifest
      'data-visualization-templates-xml', // TEMPLATE_XML_DIR — provider.getTemplateXmlFragment + content-manifest hashes
    ];
    await mkdir(desktopDataOut, { recursive: true });
    for (const entry of stagedDesktopData) {
      await cp(`${desktopDataSrc}/${entry}`, `${desktopDataOut}/${entry}`, { recursive: true });
    }
    console.log(
      `✅ Desktop data staged to ${desktopDataOut} (${stagedDesktopData.length} entries)`,
    );
  } else {
    console.log(`⏭️ Skipping desktop data staging for the '${variant}' variant (not read by it).`);
  }

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

function copyDirectory(source: string, destination: string): void {
  console.log(`🏗️ Copying ${source} to ${destination}...`);
  cpSync(source, destination, { recursive: true });
}
