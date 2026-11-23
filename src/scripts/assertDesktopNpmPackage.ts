#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { desktopPackageFiles, desktopPackageRootFiles } from './desktopNpmPackage.js';
import {
  findMissingPackageTargets,
  normalizePackResults,
  type PackResult,
} from './packedPackageTargets.js';

interface PackedPackage {
  name?: string;
  bin?: Record<string, string>;
  exports?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  scripts?: unknown;
}

function fail(message: string): never {
  console.error(`Desktop npm package check failed: ${message}`);
  process.exit(1);
}

const packJsonPath = process.argv[2];
if (!packJsonPath) {
  fail(
    'usage: npx tsx src/scripts/assertDesktopNpmPackage.ts <npm-pack-json>, written next to the tarball',
  );
}

let packResults: PackResult[];
try {
  packResults = normalizePackResults(JSON.parse(readFileSync(packJsonPath, 'utf8')));
} catch (error) {
  fail(
    `could not parse ${packJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (packResults.length !== 1) {
  fail('npm pack must report exactly one artifact');
}

const [{ filename, files }] = packResults;
if (typeof filename !== 'string' || !Array.isArray(files)) {
  fail('npm pack JSON is missing filename or files');
}

const packedPaths = files.map(({ path }) => path);
const isAllowed = (path: string): boolean =>
  (desktopPackageRootFiles as readonly string[]).includes(path) ||
  desktopPackageFiles.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));

const unexpected = packedPaths.filter((path) => !isAllowed(path));
if (unexpected.length > 0) {
  fail(`unexpected files in the tarball: ${unexpected.join(', ')}`);
}

const missing = [...desktopPackageRootFiles, ...desktopPackageFiles].filter(
  (required) => !packedPaths.some((path) => path === required || path.startsWith(`${required}/`)),
);
if (missing.length > 0) {
  fail(`required files are missing from the tarball: ${missing.join(', ')}`);
}

let packedPackage: PackedPackage;
try {
  const packedPackageJson = execFileSync(
    'tar',
    ['-xOf', resolve(dirname(packJsonPath), filename), 'package/package.json'],
    { encoding: 'utf8' },
  );
  packedPackage = JSON.parse(packedPackageJson) as PackedPackage;
} catch (error) {
  fail(
    `could not read package.json from ${filename}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (packedPackage.name !== '@tableau/mcp-server-desktop') {
  fail(`expected name @tableau/mcp-server-desktop, received ${packedPackage.name}`);
}

const binEntries = Object.entries(packedPackage.bin ?? {});
if (
  binEntries.length !== 1 ||
  binEntries[0][0] !== 'tableau-mcp-server-desktop' ||
  binEntries[0][1].replace(/^\.\//, '') !== 'build/index.desktop.js'
) {
  fail(`expected one Desktop bin, received ${JSON.stringify(packedPackage.bin)}`);
}

for (const field of [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'scripts',
  'exports',
] as const) {
  if (packedPackage[field] !== undefined) {
    fail(`package.json must not have ${field}`);
  }
}

const missingTargets = findMissingPackageTargets(packedPackage, new Set(packedPaths));
if (missingTargets.length > 0) {
  fail(`package.json bin targets are missing from the tarball: ${missingTargets.join(', ')}`);
}

process.stdout.write(
  `Desktop npm package check passed: ${filename} contains ${packedPaths.length} files and one Desktop bin\n`,
);
