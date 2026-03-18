/* eslint-disable no-console */

import { build, BuildOptions, BuildResult } from 'esbuild';
import { chmod, mkdir, rm } from 'fs/promises';

import { buildConfigurations } from './buildConfigurations';
import { globalIdentifiers } from './globalIndentifiers';

const dev = process.argv.includes('--dev');

(async () => {
  await rm('./build', { recursive: true, force: true });

  console.log('🏗️ Building all configurations...');
  for (const configuration of buildConfigurations) {
    console.log(`🏗️ Building ${configuration}...`);
    const { result, outfile } = await buildConfiguration(configuration);

    for (const error of result.errors) {
      console.log(`❌ ${error.text}`);
    }

    for (const warning of result.warnings) {
      console.log(`⚠️ ${warning.text}`);
    }

    await chmod(outfile, '755');
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

async function buildConfiguration(
  configuration: string,
): Promise<{ result: BuildResult<BuildOptions>; outfile: string }> {
  process.env.BUILD_CONFIGURATION = configuration;
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
      // 'import.meta.env.BUILD_CONFIGURATION': JSON.stringify(process.env.BUILD_CONFIGURATION),
      ...globalIdentifiers.reduce<Record<`import.meta.env.${string}`, string>>(
        (acc, { name, defaultValue }) => {
          acc[`import.meta.env.${name}`] = JSON.stringify(process.env[name] ?? defaultValue);
          return acc;
        },
        {},
      ),
    },
    // must be last so that the action can override previous build options
    ...globalIdentifiers.reduce((acc, { name, defaultValue, action }) => {
      return { ...acc, ...action(process.env[name] ?? defaultValue) };
    }, {}),
  };

  const result = await build(buildOptions);
  return { result, outfile: buildOptions.outfile ?? '' };
}
