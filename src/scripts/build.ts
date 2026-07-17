/* eslint-disable no-console */

import { build, BuildOptions, context } from 'esbuild';
import { cpSync } from 'fs';
import { chmod, copyFile, cp, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { GlobalIdentifierName, globalIdentifiers } from './globalIdentifiers.js';
import { isVariant, variants } from './variants.js';

const dev = process.argv.includes('--dev');
const dirty = process.argv.includes('--dirty');
const watch = process.argv.includes('--watch');
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
    // NOTE: desktop data is NOT copied here. It is staged below through the AUTHORITATIVE
    // allowlist (`stagedDesktopData`). A blanket copy of src/desktop/data used to run here
    // and silently defeated that allowlist (TR1) — do not reintroduce it.
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

  // Stage the bundled authoring data into the build output. esbuild bundles CODE
  // only — these files are read at runtime via fs, so a published / npm-installed
  // server has no data unless we copy them. The target `build/desktop/data` is the
  // path server.desktop.ts resolves package-relative as DATA_ROOT (`__dirname/desktop/data`,
  // where __dirname === build/ in the bundle); the binder, the BundledIntelligenceProvider,
  // and the search library all read their inputs through it.
  //
  // AUTHORITATIVE ALLOWLIST, not a blanket copy (Lane M5 tarball scoping + TR1 fix): stage
  // ONLY the entries below, so a large asset can never silently ride into the npm tarball.
  // The earlier blanket `copyDirectory('./src/desktop/data', ...)` defeated this list and was
  // removed. Every entry is resolved package-relative via DATA_ROOT and feeds either the
  // binder core / BundledIntelligenceProvider (bind-template / list-templates) or a shipped
  // search tool: tableau-desktop-commands-reference.json (search-commands),
  // workbook-schema-reference.json (lookup-workbook-schema), corpus.json + examples/
  // (search-examples / search-workbook-examples), and twb-example-index.json — the committed
  // TRIMMED index (~920 KB). Its ~10 MB ungzipped source lives OUTSIDE this dir at
  // src/desktop/data-source/ and is never staged.
  //
  // VARIANT-GATED: only the desktop tool surface (the `desktop` and `combined` variants)
  // ever resolves `build/desktop/data` at runtime. The `default` variant's server
  // (src/index.ts) never reads it — and `default` is the ONLY variant the publish pipeline
  // builds via `npm run build` — so staging is skipped there to keep the default package lean.
  if (variant === 'desktop' || variant === 'combined') {
    console.log('🏗️ Staging desktop data (allowlist)...');
    const desktopDataSrc = './src/desktop/data';
    const desktopDataOut = './build/desktop/data';
    // LOCKSTEP: this allowlist is mirrored in
    // src/desktop/intelligence/content-manifest-staging.test.ts (STAGED_DESKTOP_DATA).
    // build.ts runs an IIFE at import (can't be imported without side effects), so the
    // test parses this array out of build.ts and fails if the two diverge. That test also
    // PROVES every content-manifest.json resource lands under one of these roots and that
    // the src/desktop/data-source/ trim source can never be staged.
    const stagedDesktopData = [
      'template-manifests', // MANIFESTS_DIR — loadManifests() (binder + provider)
      'template-manifests.index.json', // MANIFEST_INDEX_PATH — loadManifests()
      'template-manifests.fixture.json', // BINDER_FIXTURE_PATH — eligibility gate
      'content-manifest.json', // CONTENT_MANIFEST_PATH — provider.getStatus/getContentManifest
      'data-visualization-templates-xml', // TEMPLATE_XML_DIR — provider.getTemplateXmlFragment + content-manifest hashes
      'templates', // legacy XML templates read via DATA_ROOT
      'tableau-desktop-commands-reference.json', // searchLibrary COMMANDS_REFERENCE_PATH — search-commands
      'workbook-schema-reference.json', // searchLibrary SCHEMA_REFERENCE_PATH — lookup-workbook-schema
      'corpus.json', // searchExamples/searchWorkbookExamples CORPUS_PATH
      'twb-example-index.json', // searchLibrary TWB_INDEX_PATH — committed trimmed index (~920 KB)
      'examples', // searchLibrary EXAMPLES_DIR — search-examples
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

  if (watch) {
    // Watch re-bundles ONLY the main entry — the fast TS edit loop. Telemetry, features.json,
    // desktop data, and the MCP Apps are built once above; editing those needs a full rebuild.
    // esbuild cannot push new code into the already-running MCP process, so each rebuild still
    // requires reconnecting the stdio server (/mcp) to take effect.
    const ctx = await context({
      ...buildOptions,
      plugins: [
        ...(buildOptions.plugins ?? []),
        {
          name: 'watch-reporter',
          setup(build) {
            build.onEnd(async (result) => {
              for (const error of result.errors) {
                console.log(`❌ ${error.text}`);
              }
              for (const warning of result.warnings) {
                console.log(`⚠️ ${warning.text}`);
              }
              if (result.errors.length === 0 && buildOptions.outfile) {
                await chmod(buildOptions.outfile, '755');
                console.log(
                  `✅ Rebuilt ${buildOptions.outfile} — reconnect the MCP (/mcp) to load it.`,
                );
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
    console.log(
      `\n👀 Watching src for changes (re-bundling ${buildOptions.outfile} only). Ctrl-C to stop.`,
    );
  }
})();

function copyDirectory(source: string, destination: string): void {
  console.log(`🏗️ Copying ${source} to ${destination}...`);
  cpSync(source, destination, { recursive: true });
}
