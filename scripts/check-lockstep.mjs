#!/usr/bin/env node
// scripts/check-lockstep.mjs
//
// LOCKSTEP-CORE HASH GATE (W14-LS1 mirror). This repo is the CANONICAL home of the
// lockstep-core engine files; consumer repos (agent-to-tableau-desktop) carry
// byte-identical copies verified by the same sha256 manifest. This gate fails when a
// core file changes without `lockstep.hashes.json` being regenerated — making silent
// drift impossible to merge on either side.
//
// Intentional engine change? Update the core file, then regenerate the manifest:
//   node scripts/check-lockstep.mjs --update
// and re-sync consumers (a2td: `node scripts/sync-lockstep-core.mjs`), so both repos'
// manifests carry the same hashes — that equality IS the cross-repo invariant.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HASHES_REL = 'lockstep.hashes.json';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const hashesPath = join(REPO_ROOT, HASHES_REL);
const manifest = JSON.parse(readFileSync(hashesPath, 'utf8'));
const entries = Object.entries(manifest);
if (entries.length === 0) {
  console.error(`[check-lockstep] FATAL: ${HASHES_REL} lists no files.`);
  process.exit(2);
}

if (process.argv.includes('--update')) {
  const updated = Object.fromEntries(
    Object.keys(manifest).map((rel) => [rel, sha256(readFileSync(join(REPO_ROOT, rel)))]),
  );
  writeFileSync(hashesPath, JSON.stringify(updated, null, 2) + '\n');
  console.log(`[check-lockstep] regenerated ${HASHES_REL} (${entries.length} files). Re-sync consumer repos.`);
  process.exit(0);
}

const drift = [];
for (const [rel, expected] of entries) {
  let actual;
  try {
    actual = sha256(readFileSync(join(REPO_ROOT, rel)));
  } catch (e) {
    drift.push(`  MISSING  ${rel}  (${e.code ?? e.message})`);
    continue;
  }
  if (actual !== expected) {
    drift.push(`  DRIFT    ${rel}\n    expected ${expected}\n    actual   ${actual}`);
  }
}

if (drift.length > 0) {
  console.error(`[check-lockstep] FAIL: lockstep-core drift (${drift.length}/${entries.length}):`);
  console.error(drift.join('\n'));
  console.error(
    `\n  These files are byte-locked with consumer repos. If this change is an intentional\n` +
      `  engine update: \`node scripts/check-lockstep.mjs --update\`, commit the manifest with\n` +
      `  the change, and re-sync consumers so both manifests carry identical hashes.`,
  );
  process.exit(1);
}
console.log(`[check-lockstep] OK: ${entries.length} lockstep-core file(s) match ${HASHES_REL}.`);
