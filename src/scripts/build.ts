/* eslint-disable no-console */

import { spawnSync } from 'child_process';
import { build } from 'esbuild';
import { chmod, mkdir, rm } from 'fs/promises';

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

  await chmod('./build/index.js', '755');

  console.log('🏗️ Building web...');
  const webResult = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    cwd: './src/web',
    shell: true,
  });

  if (webResult.status !== 0) {
    console.error('❌ Web build failed');
    console.error(`   Exit code: ${webResult.status}`);
    console.error(`   stderr: ${String(webResult.stderr).trim()}`);
    process.exit(webResult.status ?? 1);
  }
})();
