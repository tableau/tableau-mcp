/* eslint-disable no-console */
import chokidar from 'chokidar';
import { context } from 'esbuild';
import { cpSync, statSync } from 'fs';
import { extname, relative } from 'path';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const staticAssets = [
  { source: './src/server/ui/views', destination: './build/server/ui/views', ext: '.html' },
];

// WASM files that need to be copied to build directory
const wasmAssets = [
  { source: './node_modules/jq-web/jq.wasm', destination: './build/jq.wasm' },
];

(async () => {
  const ctx = await context({
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
  });

  await ctx.rebuild();

  // Copy WASM assets
  for (const { source, destination } of wasmAssets) {
    try {
      cpSync(source, destination);
      console.log(`📦 ${source} -> ${destination}`);
    } catch (error) {
      console.warn(`⚠️ Failed to copy ${source}: ${error}`);
    }
  }

  for (const { source, destination, ext } of staticAssets) {
    copyStaticAssets(source, destination, ext);

    if (!watch) {
      await ctx.dispose();
      return;
    }

    const watcher = chokidar.watch(source, {
      ignored: (path, stats) => !!(stats?.isFile() && !path.endsWith('.html')),
      ignoreInitial: true,
      persistent: true,
    });

    watcher.on('all', (event, path) => {
      const relativePath = relative(source, path);
      console.log(
        `📄 ${event}: ${relative('./src/server', path)} -> ${destination}/${relativePath}`,
      );
      cpSync(path, `${destination}/${relativePath}`);
    });
  }

  process.on('SIGINT', async () => {
    await ctx.dispose();
    process.exit(0);
  });
})();

function copyStaticAssets(source: string, destination: string, ext: string): void {
  cpSync(source, destination, {
    recursive: true,
    filter: (source) => {
      if (statSync(source).isDirectory()) {
        return true;
      }

      if (extname(source) === ext) {
        const relativePath = relative('./src/server', source);
        console.log(`📄 ${relativePath} -> ./build/server/${relativePath}`);
        return true;
      }

      return false;
    },
  });
}
