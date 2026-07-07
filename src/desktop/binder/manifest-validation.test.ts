import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { loadManifests, MANIFESTS_DIR } from './manifest.js';
import type {
  DerivationContract,
  RenderStampLedgerEntry,
  TemplateManifest,
} from './manifest-types.js';
import {
  computeFastPathEligible,
  computeFixtureBind,
  DERIVATIONS,
  FAMILY_VALUES,
  isRenderVerifiedLive,
  validateManifest,
} from './manifest-validation.js';

// This suite is the backward-compatibility proof for the A→B manifest-type SUPERSET
// (nullable RenderEvidence.structural, DerivationContract, RenderStampLedgerEntry, the
// optional TemplateManifest.derivation field): every shipped manifest must STILL validate
// through the extracted pure validator, and the new additive fields must be pass-through.

const MANIFEST_SUFFIX = '.manifest.json';

/** Read the on-disk manifest JSON files directly (NOT via loadManifests, which pre-validates). */
function readBundledManifestFiles(): Array<{ file: string; parsed: unknown }> {
  return fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith(MANIFEST_SUFFIX))
    .sort()
    .map((file) => ({
      file,
      parsed: JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, file), 'utf8')),
    }));
}

describe('binder/manifest-validation — pure module surface', () => {
  it('exports the three pure entry points required by the lockstep core', () => {
    expect(typeof validateManifest).toBe('function');
    expect(typeof computeFixtureBind).toBe('function');
    expect(typeof computeFastPathEligible).toBe('function');
  });

  it('carries the closed taxonomy + derivation set with no fs dependency', () => {
    expect(FAMILY_VALUES).toContain('time-series');
    expect(DERIVATIONS.has('sum')).toBe(true);
    expect(DERIVATIONS.has('none')).toBe(true);
    expect(isRenderVerifiedLive('live-2026-07-05')).toBe(true);
    expect(isRenderVerifiedLive('none')).toBe(false);
  });
});

describe('binder/manifest-validation — superset is backward-compatible with the bundled manifests', () => {
  const bundled = readBundledManifestFiles();

  it('there are 41 bundled manifests to check', () => {
    // W26-B re-snapshot: the shipped supply was resynced to the factory's full 39-template
    // set (17 → 39; +22 new manifests copied verbatim, trust fields unchanged).
    // W28-D true byte-for-byte mirror: the remaining stale factory manifests were resynced
    // and the factory's post-snapshot addition gantt-task-rollup-chart (#40, render_verified
    // 'none' → fast_path_eligible false) was included verbatim, taking the count 39 → 40.
    // W59 template-sync: the seven missing fast-path XMLs ported from the factory with
    // manifests copied verbatim (six overwrote stale copies; ww-ou-arrow's manifest was
    // net-new), taking the count 40 → 41.
    // Pinned in lockstep with the on-disk count so a silent add/drop of a bundled manifest
    // fails here.
    expect(bundled.length).toBe(41);
  });

  it('every bundled manifest validates through the new types’ validator (no errors)', () => {
    for (const { file, parsed } of bundled) {
      expect(validateManifest(parsed), `${file} must validate under the superset`).toEqual([]);
    }
  });

  it('stored fast_path_eligible still equals the pure predicate for every bundled manifest', () => {
    for (const { file, parsed } of bundled) {
      const m = parsed as TemplateManifest;
      expect(m.fast_path_eligible, file).toBe(computeFastPathEligible(m));
    }
  });
});

describe('binder/manifest-validation — the new superset fields are additive/pass-through', () => {
  // Start from a real, fully-valid bundled manifest so the fast_path_eligible predicate
  // and slot/calc closure stay satisfied while we exercise the new optional fields.
  function baseManifest(): TemplateManifest {
    const m = loadManifests().get('ranking-ordered-bar');
    expect(m, 'ranking-ordered-bar bundled manifest present').toBeDefined();
    return structuredClone(m!);
  }

  it('accepts a nullable RenderEvidence.structural (unmeasured legacy hand-stamp)', () => {
    const m = baseManifest();
    m.portability_evidence.render_evidence = {
      basis: 'hand-stamp: live render + human review, no numeric score recorded',
      lane: 'test',
      structural: null, // the widened field: number | null
      critical_pass: 'not recorded',
      high_pass: 'not recorded',
      pixel_oracle: 'none (anchor-only comparison is circular; not credited)',
      gate_composite: null,
    };
    expect(validateManifest(m)).toEqual([]);
  });

  it('types a RenderStampLedgerEntry as an all-optional, fail-closed record', () => {
    // Not part of the on-disk manifest schema — a purely additive convergence type.
    // A partial line must still type-check (every field optional).
    const partial: RenderStampLedgerEntry = { composite: 91, sanity: 'sane' };
    const empty: RenderStampLedgerEntry = {};
    expect(partial.composite).toBe(91);
    expect(Object.keys(empty)).toHaveLength(0);
  });
});

describe('binder/manifest-validation — validateManifest ENFORCES the DerivationContract shape (LR2-3)', () => {
  // Attach a derivation block to a known-valid bundled manifest to exercise the ported shape gate
  // (superset from A's manifest.ts). The facet-vocabulary / parent-existence cross-checks still
  // live at the golden-parity gate — this validator only enforces object shape + closed vocab.
  function withDerivation(d: unknown): unknown {
    const base = structuredClone(loadManifests().get('ranking-ordered-bar')!) as unknown as Record<
      string,
      unknown
    >;
    base.derivation = d;
    return base;
  }

  it('accepts a well-formed derivation block (disjoint, non-empty union)', () => {
    const derivation: DerivationContract = {
      parent_template: 'ww-ou-arrow',
      removed_facets: ['color-encoding-presence'],
      changed_facets: ['diff-calc-on-cols'],
    };
    expect(validateManifest(withDerivation(derivation))).toEqual([]);
  });

  it('rejects an UNKNOWN derivation key (closed-vocabulary discipline)', () => {
    expect(
      validateManifest(
        withDerivation({
          parent_template: 'p',
          removed_facets: [],
          changed_facets: ['mark-classes-per-pane'],
          bogus: 1,
        }),
      ).join(' '),
    ).toMatch(/unknown key 'bogus'/);
  });

  it('rejects a facet appearing in BOTH removed_facets and changed_facets (must be disjoint)', () => {
    expect(
      validateManifest(
        withDerivation({
          parent_template: 'p',
          removed_facets: ['mark-classes-per-pane'],
          changed_facets: ['mark-classes-per-pane'],
        }),
      ).join(' '),
    ).toMatch(/disjoint/);
  });

  it('rejects an exemption-free derivation (omit the block for a non-derivation template)', () => {
    expect(
      validateManifest(
        withDerivation({ parent_template: 'p', removed_facets: [], changed_facets: [] }),
      ).join(' '),
    ).toMatch(/no exempt facets/);
  });

  it('rejects a missing/empty parent_template and a non-string-array facet list', () => {
    expect(
      validateManifest(
        withDerivation({
          parent_template: '',
          removed_facets: [],
          changed_facets: ['mark-classes-per-pane'],
        }),
      ).join(' '),
    ).toMatch(/parent_template/);
    expect(
      validateManifest(
        withDerivation({
          parent_template: 'p',
          removed_facets: 'not-an-array',
          changed_facets: ['mark-classes-per-pane'],
        }),
      ).join(' '),
    ).toMatch(/removed_facets/);
  });
});
