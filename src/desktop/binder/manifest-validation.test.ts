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

  it('there are 17 bundled manifests to check', () => {
    expect(bundled.length).toBe(17);
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

  it('accepts an optional DerivationContract on the manifest (pass-through, not re-derived)', () => {
    const m = baseManifest();
    const derivation: DerivationContract = {
      parent_template: 'ww-ou-arrow',
      removed_facets: ['color-encoding-presence'],
      changed_facets: ['diff-calc-on-cols'],
    };
    m.derivation = derivation;
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
