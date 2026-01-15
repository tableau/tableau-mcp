/* eslint-disable no-console */

import { build } from 'esbuild';
import { chmod, rm } from 'fs/promises';

const dev = process.argv.includes('--dev');

(async () => {
  await rm('./build', { recursive: true, force: true });

  console.log('🏗️ Building...');
  const result = await build({
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

  for (const error of result.errors) {
    console.log(`❌ ${error.text}`);
  }

  for (const warning of result.warnings) {
    console.log(`⚠️ ${warning.text}`);
  }

  await chmod('./build/index.js', '755');
})();
