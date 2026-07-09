import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_MANIFEST_PATH,
  MANIFEST_INDEX_PATH,
  MANIFESTS_DIR,
  TEMPLATE_XML_DIR,
} from './manifest.js';

// W60-STAMP-HASH-GATE — the CI consumer for the render-stamp hashes.
//
// Before this suite the stamp hashes were DORMANT: `manifest-types.ts` declares the
// RenderStampLedgerEntry hash trio (`template_xml_sha256` / `manifest_unstamped_sha256`
// / `anchor_sha256`, manifest-types.ts:328-333) and two re-stamped manifests carry a
// live `portability_evidence.xml_sha256` (synced from the factory in 494d9862), but
// NOTHING in CI recomputed any of them — a template XML edit after its golden-parity
// stamp would ship silently with a stale "render-verified" claim. (The
// `scripts/backfill-stamp-hashes.mjs` populator named in the older W60 brief does not
// exist anywhere in the repo — see ~/.claude/state/w60-self-healing-mvp-spec.md — so
// this suite gates on the hash fields' DOCUMENTED semantics and the data that actually
// exists, and self-activates for the dormant trio the moment anything backfills it.)
//
// WHAT A STAMP MEANS: `portability_evidence.xml_sha256` certifies that a live
// golden-parity-verified render was earned by EXACTLY those template-XML bytes. If the
// XML on disk drifts from the stamp, the manifest's `render_verified` date is a claim
// about DIFFERENT bytes and must not be trusted — that is precisely the D8 "template
// drift vs. stamped hash" failure class. This suite makes that drift a hard CI failure
// with re-stamp guidance, and NEVER re-stamps anything itself.
//
// Template XML lives in TWO committed copies that must BOTH match the stamp:
//   - `data/templates/<t>.xml`      — the inject/apply path (templatePath.ts getTemplatePath)
//   - TEMPLATE_XML_DIR `<t>.xml`    — the shipped provider copy (provider.getTemplateXmlFragment)
// plus two GENERATED copies of the hash itself (template-manifests.index.json and
// content-manifest.json) that go stale if the generator is not re-run after a re-stamp.

const DATA_DIR = path.dirname(MANIFESTS_DIR);
/** The inject/apply-path template XML dir (server.desktop DATA_ROOT + 'templates'). */
const INJECT_TEMPLATES_DIR = path.join(DATA_DIR, 'templates');

/**
 * Non-vacuousness tripwire: templates KNOWN to carry a live xml_sha256 stamp today.
 * If one of these loses its stamp field, the gate must fail loudly instead of passing
 * vacuously forever (the "silently disarmed" failure). New stamps are picked up
 * dynamically and need no edit here.
 */
const KNOWN_XML_STAMPED = ['part-to-whole-waterfall', 'spatial-choropleth-map'];

/** The RenderStampLedgerEntry stamp-hash keys (manifest-types.ts:328-333). */
const LEDGER_STAMP_KEYS = [
  'template_xml_sha256',
  'manifest_unstamped_sha256',
  'anchor_sha256',
] as const;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function sha256OfFile(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** Recursively key-sorted JSON — the documented canonicalization for manifest_unstamped_sha256. */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  const rec = asRecord(v);
  if (!rec) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rec).sort()) out[k] = canonicalize(rec[k]);
  return out;
}

interface StampRecord {
  template: string;
  file: string;
  fastPathEligible: boolean;
  /** portability_evidence.xml_sha256 — the live factory re-stamp hash. */
  xmlSha256?: string;
  /** Top-level RenderStampLedgerEntry-style hashes (dormant today; gated when backfilled). */
  templateXmlSha256?: string;
  manifestUnstampedSha256?: string;
  anchorSha256?: string;
  /** golden.anchor_sha256 + the checkpoint it anchors (GoldenSpec). */
  goldenAnchorSha256?: string;
  goldenCheckpointRender?: string;
  json: Record<string, unknown>;
}

function loadStampRecords(): StampRecord[] {
  const files = fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.manifest.json'))
    .sort();
  return files.map((file) => {
    const json = asRecord(JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, file), 'utf8')));
    if (!json) throw new Error(`Manifest ${file} is not a JSON object`);
    const pe = asRecord(json.portability_evidence);
    const golden = asRecord(json.golden);
    return {
      template: asString(json.template) ?? file.replace(/\.manifest\.json$/, ''),
      file,
      fastPathEligible: json.fast_path_eligible === true,
      xmlSha256: asString(pe?.xml_sha256),
      templateXmlSha256: asString(json.template_xml_sha256),
      manifestUnstampedSha256: asString(json.manifest_unstamped_sha256),
      anchorSha256: asString(json.anchor_sha256),
      goldenAnchorSha256: asString(golden?.anchor_sha256),
      goldenCheckpointRender: asString(golden?.checkpoint_render),
      json,
    };
  });
}

const records = loadStampRecords();
const xmlStamped = records.filter((r) => r.xmlSha256 !== undefined);

function restampGuidance(r: StampRecord): string {
  return (
    'The stamp certifies a golden-parity-verified live render of EXACTLY those template-XML bytes; ' +
    "on drift the manifest's render_verified claim is stale. Fix: (a) revert the template XML change, or " +
    `(b) re-earn the stamp — re-run the golden-parity gate on '${r.template}' (factory re-stamp flow, ` +
    `cf. commit 494d9862), sync the refreshed xml_sha256 into src/desktop/data/template-manifests/${r.file}, ` +
    'then regenerate the index + content manifest: npx tsx src/scripts/buildTemplateManifests.ts. ' +
    'NEVER hand-edit the hash to match unverified XML — that forges a render stamp.'
  );
}

describe('stamp-hash gate (W60): committed render-stamp hashes match on-disk truth', () => {
  it('tripwire: the known stamped templates still carry portability_evidence.xml_sha256 (gate must not be silently disarmed)', () => {
    const stamped = xmlStamped.map((r) => r.template);
    for (const t of KNOWN_XML_STAMPED) {
      expect(
        stamped,
        `Template '${t}' no longer carries portability_evidence.xml_sha256 — removing a stamp hash ` +
          'disarms this gate for that template. If the stamp was retired on purpose, update ' +
          'KNOWN_XML_STAMPED here with a justification; otherwise restore the hash.',
      ).toContain(t);
    }
  });

  describe('portability_evidence.xml_sha256: template XML on disk matches the stamp', () => {
    const copies: { label: string; dir: string }[] = [
      { label: 'inject/apply copy (data/templates)', dir: INJECT_TEMPLATES_DIR },
      { label: 'shipped provider copy (data-visualization-templates-xml)', dir: TEMPLATE_XML_DIR },
    ];
    for (const r of xmlStamped) {
      for (const { label, dir } of copies) {
        it(`${r.template}: ${label} matches the stamped xml_sha256`, () => {
          const xmlPath = path.join(dir, `${r.template}.xml`);
          expect(
            fs.existsSync(xmlPath),
            `Template '${r.template}' carries a render stamp but its XML is missing at ${xmlPath}.`,
          ).toBe(true);
          const actual = sha256OfFile(xmlPath);
          expect(
            actual,
            `STAMP-HASH DRIFT: template '${r.template}' XML at ${xmlPath} no longer matches the ` +
              `render-stamped portability_evidence.xml_sha256 in ${r.file} ` +
              `(stamped ${r.xmlSha256}, recomputed ${actual}). ` +
              restampGuidance(r),
          ).toBe(r.xmlSha256);
        });
      }
    }
  });

  describe('generated copies of the stamp are not stale', () => {
    const index = asRecord(JSON.parse(fs.readFileSync(MANIFEST_INDEX_PATH, 'utf8')));
    const indexTemplates = Array.isArray(index?.templates) ? index.templates.map(asRecord) : [];
    const content = asRecord(JSON.parse(fs.readFileSync(CONTENT_MANIFEST_PATH, 'utf8')));
    const resources = Array.isArray(content?.resources) ? content.resources.map(asRecord) : [];

    for (const r of xmlStamped) {
      it(`${r.template}: template-manifests.index.json carries the same xml_sha256`, () => {
        const entry = indexTemplates.find((t) => asString(t?.template) === r.template);
        expect(
          entry,
          `Template '${r.template}' missing from template-manifests.index.json`,
        ).toBeDefined();
        const indexed = asString(asRecord(entry?.portability_evidence)?.xml_sha256);
        expect(
          indexed,
          `Stale generated index: template-manifests.index.json xml_sha256 for '${r.template}' ` +
            `(${indexed}) disagrees with ${r.file} (${r.xmlSha256}). ` +
            'Re-run: npx tsx src/scripts/buildTemplateManifests.ts',
        ).toBe(r.xmlSha256);
      });

      it(`${r.template}: content-manifest.json resource hash matches the stamped XML bytes`, () => {
        const resPath = `data-visualization-templates-xml/${r.template}.xml`;
        const entry = resources.find((res) => asString(res?.path) === resPath);
        expect(entry, `Resource '${resPath}' missing from content-manifest.json`).toBeDefined();
        expect(
          asString(entry?.sha256),
          `Stale content-manifest.json: sha256 for '${resPath}' disagrees with the render-stamped ` +
            `xml_sha256 in ${r.file}. Re-run: npx tsx src/scripts/buildTemplateManifests.ts`,
        ).toBe(r.xmlSha256);
      });
    }
  });

  describe('RenderStampLedgerEntry hash trio (dormant — self-activates on backfill)', () => {
    const ledgerStamped = records.filter((r) =>
      LEDGER_STAMP_KEYS.some((k) => asString(r.json[k]) !== undefined),
    );

    if (ledgerStamped.length === 0) {
      it('no manifest carries top-level template_xml_sha256 / manifest_unstamped_sha256 / anchor_sha256 yet — contract armed', () => {
        // Pinned-current-behavior: the trio is declared (manifest-types.ts:328-333) but
        // unpopulated (no backfill script exists in-repo). The branches below activate
        // automatically the moment any manifest is backfilled — no test edit needed.
        expect(ledgerStamped).toHaveLength(0);
      });
    }

    for (const r of ledgerStamped) {
      if (r.templateXmlSha256 !== undefined) {
        it(`${r.template}: template_xml_sha256 matches the raw template XML bytes`, () => {
          const xmlPath = path.join(INJECT_TEMPLATES_DIR, `${r.template}.xml`);
          expect(
            sha256OfFile(xmlPath),
            `STAMP-HASH DRIFT: '${r.template}' template_xml_sha256 in ${r.file} does not match ${xmlPath}. ` +
              restampGuidance(r),
          ).toBe(r.templateXmlSha256);
        });
      }
      if (r.manifestUnstampedSha256 !== undefined) {
        it(`${r.template}: manifest_unstamped_sha256 matches the canonicalized stamp-free manifest`, () => {
          // Documented semantics (manifest-types.ts:330): manifest with stamp fields
          // excluded, canonicalized (key-sorted). Exclusion set = the hash trio itself.
          const unstamped: Record<string, unknown> = { ...r.json };
          for (const k of LEDGER_STAMP_KEYS) delete unstamped[k];
          const actual = createHash('sha256')
            .update(JSON.stringify(canonicalize(unstamped)))
            .digest('hex');
          expect(
            actual,
            `STAMP-HASH DRIFT: '${r.template}' manifest_unstamped_sha256 in ${r.file} does not match ` +
              'the recomputed canonical (key-sorted, stamp-fields-excluded) manifest hash. ' +
              restampGuidance(r),
          ).toBe(r.manifestUnstampedSha256);
        });
      }
      if (r.anchorSha256 !== undefined && r.goldenAnchorSha256 !== undefined) {
        it(`${r.template}: top-level anchor_sha256 agrees with golden.anchor_sha256 (copied-from contract)`, () => {
          expect(
            r.anchorSha256,
            `'${r.template}' top-level anchor_sha256 disagrees with golden.anchor_sha256 in ${r.file} — ` +
              'the ledger field is documented as a COPY of the golden anchor (manifest-types.ts:332).',
          ).toBe(r.goldenAnchorSha256);
        });
      }
    }
  });

  describe('golden.anchor_sha256: checkpoint-render anchor', () => {
    const anchored = records.filter((r) => r.goldenAnchorSha256 !== undefined);
    for (const r of anchored) {
      const cp = r.goldenCheckpointRender;
      const abs = cp !== undefined ? path.join(process.cwd(), cp) : undefined;
      const checkpointCommitted = abs !== undefined && fs.existsSync(abs);
      // RESIDUAL (do not delete the skip silently): ww-ou-arrow's checkpoint render
      // ("Super Bowl by the Numbers.twbx") is NOT committed — the golden lives
      // local-only, so its anchor hash is UNVERIFIABLE in CI. The skip is the explicit
      // test-level annotation of that gap; the assertion arms itself if the checkpoint
      // is ever committed. NOT re-stamped here — re-stamping is never this gate's job.
      it.skipIf(!checkpointCommitted)(
        `${r.template}: golden.anchor_sha256 matches the committed checkpoint render bytes (${cp ?? 'MISSING checkpoint_render path'}) — skipped when the checkpoint is not committed (unverifiable in CI)`,
        () => {
          expect(
            sha256OfFile(abs as string),
            `STAMP-HASH DRIFT: '${r.template}' golden.anchor_sha256 in ${r.file} does not match the ` +
              `checkpoint render at ${cp}. The golden anchor the render stamp was earned against has ` +
              'changed — re-earn the stamp via the golden-parity gate or restore the original checkpoint. ' +
              'Do NOT hand-edit the anchor hash.',
          ).toBe(r.goldenAnchorSha256);
        },
      );
    }
  });
});
