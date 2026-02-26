import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { build, type InlineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const outDir = resolve(__dirname, '../../../../build/web');

function discoverComponents(srcDir: string): { name: string; tsxPath: string }[] {
  return readdirSync(srcDir, { recursive: true })
    .filter((f) => f.toString().endsWith('.tsx') && !f.toString().includes('.d.'))
    .map((f) => ({
      name: basename(f.toString(), '.tsx'),
      tsxPath: resolve(srcDir, f.toString()),
    }));
}

const componentTemplatePath = resolve(__dirname, 'component-template.html');

//  vite-plugin-singlefile only inlines assets into an HTML document, so each
//  component build needs its own temporary HTML entry point that imports the
//  TSX file. We write this into a throwaway temp directory.
function createTempHtmlEntry(componentName: string, tsxPath: string, tempDir: string): string {
  const template = readFileSync(componentTemplatePath, 'utf-8');
  const html = template
    .replace(/\{\{componentName\}\}/g, componentName)
    .replace(/\{\{tsxPath\}\}/g, tsxPath);

  const htmlPath = resolve(tempDir, `${componentName}.html`);
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html, 'utf-8');
  return htmlPath;
}

function buildConfig(htmlEntryPath: string, componentName: string): InlineConfig {
  return {
    // Root must be the directory containing the HTML so Vite can resolve the
    // TSX import written as an absolute path inside the template.
    root: dirname(htmlEntryPath),

    plugins: [
      react(),
      viteSingleFile({
        removeViteModuleLoader: true, // strips the module-preload shim
        inlinePattern: ['**/*.js', '**/*.css'], // inline everything
      }),
    ],

    css: {
      devSourcemap: isDev,
    },

    build: {
      outDir,
      // Don't wipe the output dir between components — each one writes its own file
      emptyOutDir: false,
      sourcemap: isDev ? 'inline' : false,
      minify: isDev ? false : 'esbuild',
      rollupOptions: {
        input: { [componentName]: htmlEntryPath },
      },
    },
  };
}

async function main(): Promise<void> {
  const srcDir = resolve(__dirname, '../apps');
  const components = discoverComponents(srcDir);

  if (components.length === 0) {
    console.error(`No .tsx files found in ${srcDir}`);
    process.exit(1);
  }

  // Ensure output dir exists before any parallel build tries to write into it
  mkdirSync(outDir, { recursive: true });

  // Use a single temp directory for all HTML entry stubs; clean it up after
  const tempDir = resolve(__dirname, '../temp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  console.log(
    `Building ${components.length} component(s) -> ${outDir}`,
    `[${isDev ? 'development' : 'production'}]\n`,
  );

  try {
    const results = await Promise.allSettled(
      components.map(async ({ name, tsxPath }) => {
        const htmlEntry = createTempHtmlEntry(name, tsxPath, tempDir);
        const config = buildConfig(htmlEntry, name);
        await build(config);
        return name;
      }),
    );

    let failures = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        console.log(`  ✅  ${result.value}.html`);
      } else {
        console.error('  ❌  Build error:', result.reason);
        failures++;
      }
    }

    console.log();
    if (failures > 0) {
      console.error(`${failures} component(s) failed to build.`);
      process.exit(1);
    } else {
      console.log('All components built successfully.');
    }
  } finally {
    // Clean up temp HTML stubs
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
