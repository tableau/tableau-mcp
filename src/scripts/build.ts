/* eslint-disable no-console */

import { build, BuildOptions, BuildResult } from 'esbuild';
import { chmod, mkdir, rm } from 'fs/promises';

import { buildModes, isBuildMode } from './buildModes';
import { GlobalIdentifierName, globalIdentifiers } from './globalIndentifiers';

const dev = process.argv.includes('--dev');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'default';

if (!isBuildMode(mode)) {
  throw new Error(`Invalid build mode: ${mode}. Expected one of: ${buildModes.join(', ')}`);
}

(async () => {
  await rm('./build', { recursive: true, force: true });

  const result = await buildForMode(mode);

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
})();

async function buildForMode(mode: string): Promise<BuildResult<BuildOptions>> {
  console.log(`🏗️ Building ${mode}...`);

  const env: Record<GlobalIdentifierName, string> = {
    BUILD_MODE: mode,
  };

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
    define: {
      // 'import.meta.env.BUILD_MODE': JSON.stringify(env.BUILD_MODE),
      ...globalIdentifiers.reduce<Record<`import.meta.env.${string}`, string>>(
        (acc, { name, defaultValue }) => {
          acc[`import.meta.env.${name}`] = JSON.stringify(env[name] ?? defaultValue);
          return acc;
        },
        {},
      ),
    },
    // must be last so that the action can override previous build options
    ...globalIdentifiers.reduce((acc, { name, defaultValue, action }) => {
      return { ...acc, ...action(env[name] ?? defaultValue) };
    }, {}),
  };

  if (!buildOptions.outfile) {
    throw new Error('outfile build option must be specified');
  }

  const result = await build(buildOptions);
  await chmod(buildOptions.outfile, '755');

  return result;
}
