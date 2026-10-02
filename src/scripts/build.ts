/* eslint-disable no-console */

import { build, BuildOptions, context } from 'esbuild';
import { cpSync } from 'fs';
import { chmod, copyFile, cp, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { buildTemplateZip, TEMPLATE_ZIP_FILENAME } from './buildTemplateZip.js';
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

  // Stage only allowlisted Desktop assets; Desktop-capable builds need them, while Web npm does not.
  if (variant === 'desktop' || variant === 'combined') {
    console.log('🏗️ Staging desktop data (allowlist)...');
    const desktopDataSrc = './src/desktop/data';
    const desktopDataOut = './build/desktop/data';
    const stagedDesktopData = [
      'twb_2026.2.0.xsd', // searchLibrary WORKBOOK_XSD_PATH — lookup-workbook-schema
      'corpus.json', // searchExamples/searchWorkbookExamples CORPUS_PATH
      'twb-example-index.json', // searchLibrary TWB_INDEX_PATH — committed trimmed index (~920 KB)
      'examples', // searchLibrary EXAMPLES_DIR — search-examples
      'templates', // Compatibility fallback until TAS materializes the published content pack.
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

  // scaffold-data-app serves a static, un-substituted template zip (both local and S3 modes) from
  // an asset bundled next to index.js (same idiom as features.json). Rebuild the zip fresh from the
  // committed template tree so it can't drift, then ship only that one file — the raw tree is no
  // longer read directly at runtime.
  console.log('🏗️ Building scaffold-data-app template zip...');
  await buildTemplateZip();
  await mkdir(resolve(process.cwd(), 'build', 'templates'), { recursive: true });
  await copyFile(
    resolve(process.cwd(), 'src/templates', TEMPLATE_ZIP_FILENAME),
    resolve(process.cwd(), 'build', 'templates', TEMPLATE_ZIP_FILENAME),
  );
  console.log('✅ template zip built and copied successfully');

  console.log('🏗️ Building MCP Apps...');
  try {
    const appsDir = resolve(process.cwd(), 'src/web/apps');

    // Each entry is a self-contained, single-file HTML bundled by functionality:
    // Each entry is a self-contained, single-file HTML bundled by functionality, and now
    // lives inside its feature folder next to its entry .ts:
    // - embed/mcp-app.html: embeds a Tableau viz (get-view / get-workbook).
    // - hitl/hitl-confirm.html: the MCP-Apps HITL confirm panel for delete/update preview tools.
    // Setting `root` to each feature folder makes viteSingleFile emit the output flat as
    // dist/<name>.html (the dist filenames appConfig.ts + server.web.ts depend on are unchanged).
    // Build each entry separately so every output is fully inlined; emptyOutDir:false lets them
    // share the dist directory.
    const htmlEntries = [
      { root: resolve(appsDir, 'src/embed'), html: 'mcp-app.html' },
      { root: resolve(appsDir, 'src/hitl'), html: 'hitl-confirm.html' },
    ];

    const distDir = resolve(appsDir, 'dist');
    for (const entry of htmlEntries) {
      await viteBuild({
        configFile: false, // Don't load vite.config.ts
        root: entry.root,
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
            input: resolve(entry.root, entry.html),
          },
          outDir: distDir,
          emptyOutDir: false,
        },
      });
    }

    // Copy each built HTML to the build directory.
    const buildWebApps = './build/web/apps/dist';
    await mkdir(buildWebApps, { recursive: true });
    for (const entry of htmlEntries) {
      await copyFile(
        resolve(distDir, entry.html),
        resolve(process.cwd(), buildWebApps, entry.html),
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
