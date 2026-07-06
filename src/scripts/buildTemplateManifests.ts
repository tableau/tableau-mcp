#!/usr/bin/env node
/* eslint-disable no-console */

// Generator for the bundled authoring content artifacts (Lane M3 day 3):
//   1. src/desktop/data/template-manifests.index.json — a generated roll-up of every
//      per-template `*.manifest.json` (full objects, verbatim) + the sorted
//      fast_path_templates list. Consumed by tooling/inspection; the binder itself
//      loads the per-file manifests via loadManifests().
//   2. src/desktop/data/content-manifest.json — the milestone-1 content manifest the
//      AuthoringIntelligenceProvider serves: content_version (package version + date),
//      schema_version, generated date, engine-compat range, and a sha256 per bundled
//      resource (manifests + index + fixture + template XML).
//
// AGENTS.md: generated files are never hand-edited — edit the per-template
// `*.manifest.json` (or the authored `template-manifests.fixture.json`) and re-run
// `npx tsx src/scripts/buildTemplateManifests.ts`.

import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

import packageJson from '../../package.json';

// @ts-expect-error - import.meta is not allowed in CommonJS output; this script is run with tsx as ESM.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Bumped when the manifest/content SHAPE changes in a way consumers must react to. */
const SCHEMA_VERSION = '1';
const GENERATOR = 'src/scripts/buildTemplateManifests.ts';
const RERUN = 'npx tsx src/scripts/buildTemplateManifests.ts';

const DATA_DIR = join(__dirname, '..', 'desktop', 'data');
const MANIFESTS_DIR = join(DATA_DIR, 'template-manifests');
const XML_DIR = join(DATA_DIR, 'data-visualization-templates-xml');
const INDEX_PATH = join(DATA_DIR, 'template-manifests.index.json');
const FIXTURE_PATH = join(DATA_DIR, 'template-manifests.fixture.json');
const CONTENT_MANIFEST_PATH = join(DATA_DIR, 'content-manifest.json');

const MANIFEST_SUFFIX = '.manifest.json';

interface TemplateLike {
  template: string;
  fast_path_eligible: boolean;
  [k: string]: unknown;
}

function sha256(path: string): { sha256: string; bytes: number } {
  const buf = readFileSync(path);
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.byteLength };
}

function sortedJsonFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort();
}

// ── 1. template-manifests.index.json ─────────────────────────────────────────
const manifestFiles = sortedJsonFiles(MANIFESTS_DIR, MANIFEST_SUFFIX);
const templates: TemplateLike[] = manifestFiles.map(
  (f) => JSON.parse(readFileSync(join(MANIFESTS_DIR, f), 'utf8')) as TemplateLike,
);
const fastPathTemplates = templates
  .filter((t) => t.fast_path_eligible)
  .map((t) => t.template)
  .sort();

const index = {
  _generated: true,
  _generator: GENERATOR,
  _warning: `GENERATED FILE — do not hand-edit. Edit data/template-manifests/*.manifest.json and re-run \`${RERUN}\`.`,
  _source: 'data/template-manifests/*.manifest.json',
  count: templates.length,
  fast_path_templates: fastPathTemplates,
  templates,
};
writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
console.log(`✅ Wrote ${relative(process.cwd(), INDEX_PATH)} (${templates.length} templates)`);

// ── 2. content-manifest.json ─────────────────────────────────────────────────
// Hash every bundled authoring resource. Deterministic: files are enumerated in
// sorted relative-path order, and `generated` is date-only so a same-day re-run
// produces no spurious diff. content-manifest.json itself is excluded.
const resourcePaths = [
  ...manifestFiles.map((f) => join(MANIFESTS_DIR, f)),
  INDEX_PATH,
  FIXTURE_PATH,
  ...sortedJsonFiles(XML_DIR, '.xml').map((f) => join(XML_DIR, f)),
];

const resources = resourcePaths
  .map((p) => ({ path: relative(DATA_DIR, p), ...sha256(p) }))
  .sort((a, b) => a.path.localeCompare(b.path));

const date = new Date().toISOString().slice(0, 10);
const contentManifest = {
  _generated: true,
  _generator: GENERATOR,
  _warning: `GENERATED FILE — do not hand-edit. Re-run \`${RERUN}\`.`,
  content_version: `${packageJson.version}+content.${date}`,
  schema_version: SCHEMA_VERSION,
  generated: date,
  engine_compat: {
    server_min: packageJson.version,
    node: packageJson.engines.node,
  },
  resources,
};
writeFileSync(CONTENT_MANIFEST_PATH, `${JSON.stringify(contentManifest, null, 2)}\n`);
console.log(
  `✅ Wrote ${relative(process.cwd(), CONTENT_MANIFEST_PATH)} (${resources.length} resources, content_version ${contentManifest.content_version})`,
);
