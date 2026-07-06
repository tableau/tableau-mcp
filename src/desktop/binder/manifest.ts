// src/binder/manifest.ts
//
// Tier-1 fast-path binder — manifest loader + shape validator (design doc §2.1, §3.1).
//
// `loadManifests()` mirrors the repo loader idiom (`src/search/index.ts`
// `loadWorkbookExamples`): a repoRoot-relative directory read, `JSON.parse`,
// and a module-level cache. It returns the per-template manifests keyed by
// template name (== filename == inject-template `template_name`).
//
// `validateManifest()` is a pure shape/enum check with NO I/O. XML cross-checks
// (template_field exists as a <column>, placeholders present, derivation ∈
// derivationMap) live in `manifest.test.ts`, matching the "contract enforced by
// a test" pattern used for knowledge files and plan-binding.

import fs from 'fs';
import path from 'path';

import { calcForcedSlotIds } from './calc-derivation.js';
import type {
  BlockerCode,
  Derivation,
  Family,
  PortabilityEvidence,
  Readiness,
  SlotKind,
  TemplateManifest,
} from './manifest-types.js';

// PORT ADAPTATION + cwd-hazard fix (Lane M3 day 3):
// The a2td source resolved these paths from `fileURLToPath(import.meta.url)`
// (ESM-only, unavailable under this repo's `type: commonjs`). The first port used
// `process.cwd()`, which is correct only when the process starts at the repo root
// (dev / vitest) and BREAKS for an npm-installed server launched from an arbitrary
// cwd. This repo is CommonJS and esbuild-bundles to `build/index.js`, so `__dirname`
// is available in BOTH the unbundled source (`src/desktop/binder`) and the bundle
// (`build/`). We resolve PACKAGE-RELATIVE first, then fall back to cwd for back-compat.
// Candidates are probed for the index file; the first that exists wins.
//
// PUBLISH STORY (closed Lane M4 day-4): the esbuild build now stages
// `src/desktop/data` → `build/desktop/data` (see `src/scripts/build.ts`
// "Staging desktop data") and `.npmignore` ships `build/**/*`, so an npm-installed
// bundle DOES carry the data. Candidate 2 below (`__dirname/desktop/data`, where
// `__dirname === build/` in the bundle) is now the real published resolution path;
// `npm pack --dry-run` shows `build/desktop/data/**` in the tarball. Candidate 1
// serves the unbundled source / tsx-from-repo-root runtime; candidate 3 is the legacy
// cwd fallback. `dataDirCandidates`/`pickDataDir` are split out so the candidate-2
// resolution is unit-tested against faked `__dirname` layouts (manifest.dataDir.test.ts).

/** The ordered DATA_DIR candidates for a given module dir + cwd. Exported for tests. */
export function dataDirCandidates(moduleDir: string, cwd: string): string[] {
  return [
    path.join(moduleDir, '..', 'data'), // unbundled source: src/desktop/binder → src/desktop/data
    path.join(moduleDir, 'desktop', 'data'), // published bundle: build/ → build/desktop/data
    path.join(cwd, 'src', 'desktop', 'data'), // legacy cwd fallback (repo root)
  ];
}

/** First candidate that actually contains the manifest index, else the first candidate. */
export function pickDataDir(candidates: string[]): string {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'template-manifests.index.json'))) {
      return dir;
    }
  }
  return candidates[0];
}

function resolveDataDir(): string {
  return pickDataDir(dataDirCandidates(__dirname, process.cwd()));
}

const DATA_DIR = resolveDataDir();

export const MANIFESTS_DIR = path.join(DATA_DIR, 'template-manifests');
export const MANIFEST_INDEX_PATH = path.join(DATA_DIR, 'template-manifests.index.json');
/** Committed schema fixture the eligibility gate binds against (attacks 5+10). */
export const BINDER_FIXTURE_PATH = path.join(DATA_DIR, 'template-manifests.fixture.json');
/** Generated content manifest (content_version, schema_version, per-resource sha256). */
export const CONTENT_MANIFEST_PATH = path.join(DATA_DIR, 'content-manifest.json');
/** Shipped worksheet-fragment XML for templates whose golden XML ships in-package. */
export const TEMPLATE_XML_DIR = path.join(DATA_DIR, 'data-visualization-templates-xml');
const MANIFEST_SUFFIX = '.manifest.json';

// Enum members kept in sync with manifest-types.ts. A change to a union there
// must be mirrored here (validateManifest is the runtime gate for those types).
const READINESS: ReadonlySet<Readiness> = new Set<Readiness>(['GREEN', 'YELLOW', 'RED']);

/**
 * Closed chart-intent taxonomy (attack 2). The single runtime source for the
 * `Family` union in manifest-types.ts, used both by the validator's `FAMILIES` set
 * and by tool-layer schemas that must reject an out-of-taxonomy family (e.g. the
 * list-templates family filter) instead of silently returning nothing.
 */
export const FAMILY_VALUES = [
  'time-series',
  'ranking',
  'part-to-whole',
  'correlation',
  'distribution',
  'deviation',
  'magnitude',
  'spatial',
  'kpi',
  'specialized',
] as const satisfies readonly Family[];

const FAMILIES: ReadonlySet<Family> = new Set<Family>(FAMILY_VALUES);

/** render_verified format: `'none'` or a `live-YYYY-MM-DD` stamp. */
const RENDER_VERIFIED_RE = /^(none|live-\d{4}-\d{2}-\d{2})$/;
/** A render_verified value that is a live render-readback proof (not `'none'`). */
export function isRenderVerifiedLive(rv: string): boolean {
  return /^live-\d{4}-\d{2}-\d{2}$/.test(rv);
}

const SLOT_KINDS: ReadonlySet<SlotKind> = new Set<SlotKind>([
  'quantitative',
  'categorical',
  'temporal',
  'geo',
  'calc',
  'generated',
  'pseudo',
  'parameter',
]);

export const DERIVATIONS: ReadonlySet<Derivation> = new Set<Derivation>([
  'none',
  'sum',
  'avg',
  'cnt',
  'cntd',
  'median',
  'min',
  'max',
  'attr',
  'usr',
  'yr',
  'qr',
  'mn',
  'wk',
  'dy',
  'hr',
  'mi',
  'sc',
  'tyr',
  'tqr',
  'tmn',
  'tdy',
]);

const BLOCKER_CODES: ReadonlySet<BlockerCode> = new Set<BlockerCode>([
  'HARDCODED_FILTER_MEMBERS',
  'GENERATED_GEO_REQUIRED',
  'PSEUDO_FIELD_REQUIRED',
  'PARAMETER_REQUIRED',
  'NO_DATASOURCE_PLACEHOLDER',
  'DATASET_SPECIFIC_FORMULA',
]);

/** Kinds the template owns fully — the binder must never fill them. */
const NON_BINDABLE_KINDS: ReadonlySet<SlotKind> = new Set<SlotKind>([
  'calc',
  'generated',
  'pseudo',
  'parameter',
]);

let _manifestsCache: Map<string, TemplateManifest> | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * One field of the committed binder fixture — just the kinds the eligibility
 * gate needs to test slot compatibility (attacks 5+10).
 */
export interface FixtureField {
  name: string;
  role: 'dimension' | 'measure';
  type: string; // "quantitative" | "nominal" | "ordinal" | ...
  datatype: string; // "string" | "real" | "integer" | "date" | "datetime" | ...
}
export interface BinderFixture {
  datasource: string;
  fields: FixtureField[];
}

let _fixtureCache: BinderFixture | null = null;
/** Load the committed schema fixture the eligibility gate binds against. */
export function loadBinderFixture(): BinderFixture {
  if (_fixtureCache) return _fixtureCache;
  const raw = fs.readFileSync(BINDER_FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as BinderFixture;
  _fixtureCache = parsed;
  return parsed;
}

/** Does a fixture field satisfy a bindable slot's kind? (mirrors validate.ts kindCompatible.) */
function fixtureFieldFitsKind(kind: SlotKind, f: FixtureField): boolean {
  switch (kind) {
    case 'quantitative':
      return f.role === 'measure';
    case 'categorical':
      return f.role === 'dimension' && (f.type === 'nominal' || f.type === 'ordinal');
    case 'temporal':
      return f.datatype === 'date' || f.datatype === 'datetime';
    case 'geo':
      return f.role === 'dimension';
    default:
      return false; // non-bindable kinds are never fixture-bound
  }
}

/**
 * Prove portability by binding: can every required, bindable slot — PLUS every
 * bindable slot a required calc's inputs force (H3) — be filled by a DISTINCT
 * compatible field from the fixture? (attacks 5+10). Role-greedy in slot order —
 * the same assignment strategy classifyNoLlm uses. This is the runtime mirror of
 * the generator's `computeFixtureBind`; manifest.test.ts asserts the two agree with
 * the stored `portability_evidence.fixture_bind`.
 */
export function computeFixtureBind(
  m: { slots: TemplateManifest['slots']; calcs?: TemplateManifest['calcs'] },
  fields: FixtureField[],
): boolean {
  const forced = calcForcedSlotIds(m);
  const used = new Set<FixtureField>();
  for (const slot of m.slots) {
    // Bind a slot when it is required, OR when a required calc's input forces it.
    if (!slot.bindable || !(slot.required || forced.has(slot.slot_id))) continue;
    let picked: FixtureField | null = null;
    for (const f of fields) {
      if (used.has(f)) continue;
      if (fixtureFieldFitsKind(slot.kind, f)) {
        picked = f;
        break;
      }
    }
    if (!picked) return false;
    used.add(picked);
  }
  return true;
}

/**
 * The fast-path eligibility predicate (attacks 5+10). Eligible ONLY when:
 *   - readiness !== "RED", and
 *   - there are no fast_path_blockers, and
 *   - portability_evidence.fixture_bind === true (binds against the committed
 *     fixture — necessary), and
 *   - render_verified is a live render-readback stamp (the completing proof).
 * The generator and this validator both enforce the stored `fast_path_eligible`
 * equals this predicate, so the classifier can trust the flag for O(1) filtering.
 * A template that binds a fixture but is NOT render-verified honestly flips to
 * `false` — the eligible set is "portable across fixture classes + render-verified",
 * never "any dataset".
 */
export function computeFastPathEligible(m: {
  readiness: Readiness;
  fast_path_blockers: BlockerCode[];
  portability_evidence: PortabilityEvidence;
}): boolean {
  return (
    m.readiness !== 'RED' &&
    m.fast_path_blockers.length === 0 &&
    m.portability_evidence.fixture_bind === true &&
    isRenderVerifiedLive(m.portability_evidence.render_verified)
  );
}

function validateSlot(
  slot: unknown,
  idx: number,
  kind: 'slot' | 'calc',
  errors: string[],
): string | null {
  const where = `${kind}[${idx}]`;
  if (!isRecord(slot)) {
    errors.push(`${where}: not an object`);
    return null;
  }
  const slotId = typeof slot.slot_id === 'string' ? slot.slot_id : null;
  if (!slotId) errors.push(`${where}: slot_id must be a non-empty string`);
  if (typeof slot.template_field !== 'string' || slot.template_field.length === 0) {
    errors.push(`${where} (${slotId ?? '?'}): template_field must be a non-empty string`);
  }
  if (typeof slot.derivation !== 'string' || !DERIVATIONS.has(slot.derivation as Derivation)) {
    errors.push(
      `${where} (${slotId ?? '?'}): derivation '${String(slot.derivation)}' is not a valid Derivation`,
    );
  }
  if (!isStringArray(slot.role) || slot.role.length === 0) {
    errors.push(`${where} (${slotId ?? '?'}): role must be a non-empty string[]`);
  }
  if (typeof slot.kind !== 'string' || !SLOT_KINDS.has(slot.kind as SlotKind)) {
    errors.push(`${where} (${slotId ?? '?'}): kind '${String(slot.kind)}' is not a valid SlotKind`);
  }
  if (typeof slot.bindable !== 'boolean')
    errors.push(`${where} (${slotId ?? '?'}): bindable must be boolean`);
  if (typeof slot.required !== 'boolean')
    errors.push(`${where} (${slotId ?? '?'}): required must be boolean`);
  if (
    slot.qualified_key_required !== undefined &&
    typeof slot.qualified_key_required !== 'boolean'
  ) {
    errors.push(`${where} (${slotId ?? '?'}): qualified_key_required must be boolean when present`);
  }
  if (slot.notes !== undefined && typeof slot.notes !== 'string') {
    errors.push(`${where} (${slotId ?? '?'}): notes must be a string when present`);
  }
  // Non-bindable kinds must not be marked bindable.
  if (
    typeof slot.kind === 'string' &&
    NON_BINDABLE_KINDS.has(slot.kind as SlotKind) &&
    slot.bindable === true
  ) {
    errors.push(
      `${where} (${slotId ?? '?'}): kind '${slot.kind}' is non-bindable but bindable=true`,
    );
  }
  return slotId;
}

/** OUTPUT roles a calc <column> can declare. */
const CALC_RESULT_ROLES: ReadonlySet<string> = new Set(['measure', 'dimension']);

/**
 * Validate the OPTIONAL first-class calc fields (H3): `result_role`, `inputs`,
 * `avoid_when`, `prereqs`. Absent fields are always valid (an opaque legacy calc
 * entry stays valid). Shape errors are appended to `errors`; the slot_id
 * cross-reference (an input's slot_id must name a real slot) runs later where the
 * full slot_id set is known.
 */
function validateCalcExtras(
  c: Record<string, unknown>,
  i: number,
  id: string | null,
  errors: string[],
): void {
  const where = `calc[${i}] (${id ?? '?'})`;
  if (c.result_role !== undefined && !CALC_RESULT_ROLES.has(String(c.result_role))) {
    errors.push(
      `${where}: result_role '${String(c.result_role)}' must be 'measure' or 'dimension'`,
    );
  }
  if (c.avoid_when !== undefined) {
    if (
      !isStringArray(c.avoid_when) ||
      c.avoid_when.length === 0 ||
      c.avoid_when.some((s) => s.trim().length === 0)
    ) {
      errors.push(
        `${where}: avoid_when must be a non-empty string[] of non-empty strings when present`,
      );
    }
  }
  if (c.prereqs !== undefined) {
    if (!isStringArray(c.prereqs) || c.prereqs.some((s) => s.trim().length === 0)) {
      errors.push(`${where}: prereqs must be a string[] of non-empty strings when present`);
    }
  }
  if (c.inputs !== undefined) {
    if (!Array.isArray(c.inputs)) {
      errors.push(`${where}: inputs must be an array when present`);
      return;
    }
    c.inputs.forEach((inp, j) => {
      const iw = `${where}: inputs[${j}]`;
      if (!isRecord(inp)) {
        errors.push(`${iw}: not an object`);
        return;
      }
      if (typeof inp.ref !== 'string' || inp.ref.length === 0)
        errors.push(`${iw}: ref must be a non-empty string`);
      if (typeof inp.slot_kind !== 'string' || !SLOT_KINDS.has(inp.slot_kind as SlotKind)) {
        errors.push(`${iw}: slot_kind '${String(inp.slot_kind)}' is not a valid SlotKind`);
      }
      if (typeof inp.required !== 'boolean') errors.push(`${iw}: required must be boolean`);
      if (typeof inp.template_internal !== 'boolean')
        errors.push(`${iw}: template_internal must be boolean`);
      const slotIdOk = inp.slot_id === null || typeof inp.slot_id === 'string';
      if (!slotIdOk) errors.push(`${iw}: slot_id must be a string or null`);
      // Consistency: template_internal iff there is no referenced slot.
      if (typeof inp.template_internal === 'boolean' && slotIdOk) {
        const expected = inp.slot_id === null;
        if (inp.template_internal !== expected) {
          errors.push(
            `${iw}: template_internal=${inp.template_internal} disagrees with slot_id ${inp.slot_id === null ? 'null' : `'${String(inp.slot_id)}'`} (template_internal must be true iff slot_id is null)`,
          );
        }
      }
      if (inp.coercion !== undefined && typeof inp.coercion !== 'string') {
        errors.push(`${iw}: coercion must be a string when present`);
      }
    });
  }
}

/**
 * Pure shape/enum validation. Returns a list of human-readable error strings;
 * an empty array means the value is a structurally valid `TemplateManifest`.
 */
export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(m)) return ['manifest is not an object'];

  if (typeof m.template !== 'string' || m.template.length === 0) {
    errors.push('template must be a non-empty string');
  }
  if (typeof m.family !== 'string' || !FAMILIES.has(m.family as Family)) {
    errors.push(`family '${String(m.family)}' is not a valid Family`);
  }
  if (typeof m.readiness !== 'string' || !READINESS.has(m.readiness as Readiness)) {
    errors.push(`readiness '${String(m.readiness)}' must be GREEN|YELLOW|RED`);
  }
  if (typeof m.fast_path_eligible !== 'boolean') errors.push('fast_path_eligible must be boolean');

  // portability_evidence gates fast_path_eligible (attacks 5+10): required object
  // with a boolean fixture_bind and a `none | live-YYYY-MM-DD` render_verified.
  let evidenceValid = false;
  if (!isRecord(m.portability_evidence)) {
    errors.push('portability_evidence must be an object {fixture_bind, render_verified}');
  } else {
    const ev = m.portability_evidence;
    let ok = true;
    if (typeof ev.fixture_bind !== 'boolean') {
      errors.push('portability_evidence.fixture_bind must be boolean');
      ok = false;
    }
    if (typeof ev.render_verified !== 'string' || !RENDER_VERIFIED_RE.test(ev.render_verified)) {
      errors.push(
        `portability_evidence.render_verified '${String(ev.render_verified)}' must be 'none' or 'live-YYYY-MM-DD'`,
      );
      ok = false;
    }
    evidenceValid = ok;
  }
  if (typeof m.datasource_placeholder !== 'boolean')
    errors.push('datasource_placeholder must be boolean');
  if (!isStringArray(m.placeholders)) errors.push('placeholders must be string[]');
  if (!isStringArray(m.intent_keywords)) errors.push('intent_keywords must be string[]');
  if (typeof m.description !== 'string' || m.description.length === 0) {
    errors.push('description must be a non-empty string');
  }
  // avoid_when is OPTIONAL negative-routing guidance; when present it must be a
  // non-empty array of non-empty strings (the binder/prompt surface it verbatim).
  if (m.avoid_when !== undefined) {
    if (!isStringArray(m.avoid_when) || m.avoid_when.length === 0) {
      errors.push('avoid_when must be a non-empty string[] when present');
    } else if (m.avoid_when.some((s) => s.trim().length === 0)) {
      errors.push('avoid_when entries must be non-empty strings');
    }
  }

  let blockersValid = false;
  if (!Array.isArray(m.fast_path_blockers)) {
    errors.push('fast_path_blockers must be an array');
  } else {
    blockersValid = true;
    for (const b of m.fast_path_blockers) {
      if (typeof b !== 'string' || !BLOCKER_CODES.has(b as BlockerCode)) {
        errors.push(`fast_path_blockers: '${String(b)}' is not a valid BlockerCode`);
        blockersValid = false;
      }
    }
  }

  // fast_path_eligible must equal the evidence-gated predicate (attacks 5+10).
  if (
    typeof m.fast_path_eligible === 'boolean' &&
    typeof m.readiness === 'string' &&
    READINESS.has(m.readiness as Readiness) &&
    blockersValid &&
    evidenceValid
  ) {
    const expected = computeFastPathEligible({
      readiness: m.readiness as Readiness,
      fast_path_blockers: m.fast_path_blockers as BlockerCode[],
      portability_evidence: m.portability_evidence as PortabilityEvidence,
    });
    if (m.fast_path_eligible !== expected) {
      const ev = m.portability_evidence as PortabilityEvidence;
      errors.push(
        `fast_path_eligible=${m.fast_path_eligible} disagrees with predicate ` +
          `(readiness=${m.readiness}, blockers=${(m.fast_path_blockers as unknown[]).length}, ` +
          `fixture_bind=${ev.fixture_bind}, render_verified=${ev.render_verified}) → expected ${expected}`,
      );
    }
  }

  const slotIds = new Set<string>();
  if (!Array.isArray(m.slots)) {
    errors.push('slots must be an array');
  } else {
    m.slots.forEach((s, i) => {
      const id = validateSlot(s, i, 'slot', errors);
      if (id) {
        if (slotIds.has(id)) errors.push(`slot[${i}]: duplicate slot_id '${id}'`);
        slotIds.add(id);
      }
    });
  }

  if (!Array.isArray(m.calcs)) {
    errors.push('calcs must be an array');
  } else {
    m.calcs.forEach((c, i) => {
      const id = validateSlot(c, i, 'calc', errors);
      if (id) {
        if (slotIds.has(id)) errors.push(`calc[${i}]: duplicate slot_id '${id}'`);
        slotIds.add(id);
      }
      if (isRecord(c)) {
        if (c.kind !== 'calc') errors.push(`calc[${i}] (${id ?? '?'}): kind must be 'calc'`);
        if (typeof c.formula !== 'string' || c.formula.length === 0) {
          errors.push(`calc[${i}] (${id ?? '?'}): formula must be a non-empty string`);
        }
        if (!isStringArray(c.formula_refs))
          errors.push(`calc[${i}] (${id ?? '?'}): formula_refs must be string[]`);
        if (!isStringArray(c.depends_on_slots)) {
          errors.push(`calc[${i}] (${id ?? '?'}): depends_on_slots must be string[]`);
        }
        // ── H3 first-class calc fields (all OPTIONAL — backward compatible) ──
        validateCalcExtras(c, i, id, errors);
      }
    });
  }

  // Calc dependency closure is structural: every depends_on_slots id must name a
  // real slot in this manifest (design gate §2.4/6 checks binding at runtime).
  // A first-class calc input carrying a non-null slot_id must likewise resolve.
  if (Array.isArray(m.calcs)) {
    m.calcs.forEach((c, i) => {
      const who =
        typeof (c as Record<string, unknown>).slot_id === 'string'
          ? (c as Record<string, unknown>).slot_id
          : '?';
      if (isRecord(c) && isStringArray(c.depends_on_slots)) {
        for (const dep of c.depends_on_slots) {
          if (!slotIds.has(dep)) {
            errors.push(
              `calc[${i}] (${who}): depends_on_slots references unknown slot_id '${dep}'`,
            );
          }
        }
      }
      if (isRecord(c) && Array.isArray(c.inputs)) {
        c.inputs.forEach((inp, j) => {
          if (isRecord(inp) && typeof inp.slot_id === 'string' && !slotIds.has(inp.slot_id)) {
            errors.push(
              `calc[${i}] (${who}): inputs[${j}] references unknown slot_id '${inp.slot_id}'`,
            );
          }
        });
      }
    });
  }

  if (!Array.isArray(m.hazards)) {
    errors.push('hazards must be an array');
  } else {
    m.hazards.forEach((h, i) => {
      if (
        !isRecord(h) ||
        typeof h.code !== 'string' ||
        typeof h.detail !== 'string' ||
        typeof h.xml !== 'string'
      ) {
        errors.push(`hazards[${i}]: must have string {code, detail, xml}`);
      }
    });
  }

  // golden is OPTIONAL (factory templates only): a {checkpoint_render} anchor gating the
  // golden-match render_verified standard. When present it must be an object with a
  // non-empty string checkpoint_render.
  if (m.golden !== undefined) {
    if (
      !isRecord(m.golden) ||
      typeof m.golden.checkpoint_render !== 'string' ||
      m.golden.checkpoint_render.trim().length === 0
    ) {
      errors.push('golden must be an object { checkpoint_render: non-empty string } when present');
    }
  }

  // datasource_style is OPTIONAL (the fidelity fix): a captured datasource-level mark
  // style sidecar {style_rule, column_instances[], maps}. When present the style_rule
  // must carry a <style-rule> element, column_instances must be a non-empty array of
  // <column-instance> XML strings (the declarations the maps' field refs require), and
  // maps must carry numeric color/shape counts.
  if (m.datasource_style !== undefined) {
    const ds = m.datasource_style;
    if (!isRecord(ds)) {
      errors.push(
        'datasource_style must be an object { style_rule, column_instances, maps } when present',
      );
    } else {
      if (typeof ds.style_rule !== 'string' || !ds.style_rule.includes('<style-rule')) {
        errors.push(
          'datasource_style.style_rule must be a string containing a <style-rule> element',
        );
      }
      if (
        !Array.isArray(ds.column_instances) ||
        ds.column_instances.length === 0 ||
        !ds.column_instances.every((c) => typeof c === 'string' && c.includes('<column-instance'))
      ) {
        errors.push(
          'datasource_style.column_instances must be a non-empty array of <column-instance> XML strings',
        );
      }
      if (
        !isRecord(ds.maps) ||
        typeof ds.maps.color !== 'number' ||
        typeof ds.maps.shape !== 'number'
      ) {
        errors.push('datasource_style.maps must be an object { color: number, shape: number }');
      }
    }
  }

  return errors;
}

/**
 * Load every `<template>.manifest.json` under `data/template-manifests/`,
 * validate its shape, and cache the result in a module-level Map keyed by
 * template name. Throws (fail-closed) if any manifest is structurally invalid
 * or if a filename disagrees with its `template` field.
 */
export function loadManifests(): Map<string, TemplateManifest> {
  if (_manifestsCache) return _manifestsCache;
  const cache = new Map<string, TemplateManifest>();
  if (!fs.existsSync(MANIFESTS_DIR)) {
    _manifestsCache = cache;
    return cache;
  }
  const files = fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith(MANIFEST_SUFFIX))
    .sort();
  for (const file of files) {
    const filePath = path.join(MANIFESTS_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Manifest ${file} is not valid JSON: ${(e as Error).message}`);
    }
    const errors = validateManifest(parsed);
    if (errors.length > 0) {
      throw new Error(`Manifest ${file} failed shape validation:\n  - ${errors.join('\n  - ')}`);
    }
    const manifest = parsed as TemplateManifest;
    const expectedName = file.slice(0, -MANIFEST_SUFFIX.length);
    if (manifest.template !== expectedName) {
      throw new Error(
        `Manifest ${file}: template '${manifest.template}' does not match filename '${expectedName}'`,
      );
    }
    cache.set(manifest.template, manifest);
  }
  _manifestsCache = cache;
  return cache;
}

/** Test/tooling hook: drop the module-level cache so the next load re-reads disk. */
export function _resetManifestCache(): void {
  _manifestsCache = null;
}
