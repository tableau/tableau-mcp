#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  allowedPackageRootFiles,
  findMissingPackageTargets,
  findUnexpectedNonBuildFiles,
} from './packedPackageTargets.js';

interface PackFile {
  path: string;
}

interface PackResult {
  filename: string;
  files: PackFile[];
}

interface PackedPackage {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

const expectedBuildFiles = [
  'build/activityLog/provider.d.ts',
  'build/blobStorage/blobStorageProvider.d.ts',
  'build/features.json',
  'build/features/featureGateProvider.d.ts',
  'build/index.js',
  'build/index.js.map',
  'build/sessionStore/sessionStore.d.ts',
  'build/telemetry/telemetryProvider.d.ts',
  'build/telemetry/tracing.js',
  'build/telemetry/tracing.js.map',
  'build/templates/data-app-template.zip',
  'build/web/apps/dist/hitl-confirm.html',
  'build/web/apps/dist/mcp-app.html',
];

function fail(message: string): never {
  console.error(`Web npm package check failed: ${message}`);
  process.exit(1);
}

const packJsonPath = process.argv[2];
if (!packJsonPath) {
  fail('usage: npx tsx src/scripts/assertWebNpmPackage.ts <npm-pack-json>');
}

let packResults: PackResult[];
try {
  packResults = JSON.parse(readFileSync(packJsonPath, 'utf8')) as PackResult[];
} catch (error) {
  fail(
    `could not parse ${packJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (!Array.isArray(packResults) || packResults.length !== 1) {
  fail('npm pack must report exactly one artifact');
}

const [{ filename, files }] = packResults;
if (typeof filename !== 'string' || !Array.isArray(files)) {
  fail('npm pack JSON is missing filename or files');
}

const actualBuildFiles = files
  .map(({ path }) => path)
  .filter((path) => path.startsWith('build/'))
  .sort();

if (JSON.stringify(actualBuildFiles) !== JSON.stringify(expectedBuildFiles)) {
  fail(
    `build files differ from the Web allowlist\nexpected: ${expectedBuildFiles.join(', ')}\nactual: ${actualBuildFiles.join(', ')}`,
  );
}

const packedPaths = new Set(files.map(({ path }) => path));
for (const requiredPath of allowedPackageRootFiles) {
  if (!packedPaths.has(requiredPath)) {
    fail(`required package file is missing: ${requiredPath}`);
  }
}

const unexpectedRootFiles = findUnexpectedNonBuildFiles(packedPaths);
if (unexpectedRootFiles.length > 0) {
  fail(
    `unexpected non-build files in the tarball: ${unexpectedRootFiles.join(', ')}. npm always packs root README*/LICENSE*/COPYING* files, so keep variant READMEs out of the repo root`,
  );
}

let packedPackage: PackedPackage;
try {
  const packedPackageJson = execFileSync(
    'tar',
    ['-xOf', resolve(filename), 'package/package.json'],
    { encoding: 'utf8' },
  );
  packedPackage = JSON.parse(packedPackageJson) as PackedPackage;
} catch (error) {
  fail(
    `could not read package.json from ${filename}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const binEntries = Object.entries(packedPackage.bin ?? {});
if (
  binEntries.length !== 1 ||
  binEntries[0][0] !== 'tableau-mcp-server' ||
  binEntries[0][1].replace(/^\.\//, '') !== 'build/index.js'
) {
  fail(`expected one Web bin, received ${JSON.stringify(packedPackage.bin)}`);
}

if (Object.hasOwn(packedPackage.exports ?? {}, './desktop')) {
  fail('package exports must not include ./desktop');
}

const missingTargets = findMissingPackageTargets(packedPackage, packedPaths);
if (missingTargets.length > 0) {
  fail(
    `package.json main/types/bin/exports targets are missing from the tarball: ${missingTargets.join(', ')}`,
  );
}

process.stdout.write(
  `Web npm package check passed: ${filename} contains ${actualBuildFiles.length} allowed build files and one Web bin\n`,
);
