import { randomBytes } from 'node:crypto';

import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { checkUnder64Mb, MAX_SINGLE_REQUEST_BYTES } from '../_lib/publishShared.js';
import { buildTwbx, contentExtensionWarnings } from '../createAndPublishWorkbook/buildTwbx.js';
import { assetReferenceCheck } from './assetReferenceCheck.js';

// Drift guard. These assertions pin the CONTRACT between the real builder (buildTwbx +
// contentExtensionWarnings) and validate-workbook-package's added checks. If any of the builder
// constants or behaviors below change, this test must break so the change is a deliberate decision.

const base = {
  packageId: 'com.example.myviz',
  workbookName: 'My Viz',
};

// The validator's effective logic, expressed here against the REAL builder so the round-trip proves
// the tool would produce the same warnings.
function validate(input: {
  packageId: string;
  workbookName: string;
  html: string;
  assets?: Array<{ path: string; bytes: Uint8Array }>;
}): { ok: boolean; warnings: string[]; byteLength: number } {
  const { bytes, warnings: buildWarnings } = buildTwbx(input);
  const warnings = [...buildWarnings];
  warnings.push(
    ...assetReferenceCheck(
      input.html,
      (input.assets ?? []).map((a) => a.path),
    ),
  );
  // Use the REAL size guard so the over-64MB message stays pinned to production code (drift guard).
  const sizeError = checkUnder64Mb(bytes.byteLength);
  if (sizeError) {
    warnings.push(sizeError.getErrorText());
  }
  return { ok: warnings.length === 0, warnings, byteLength: bytes.byteLength };
}

describe('package validation contract (drift guard)', () => {
  it('a self-contained good package: buildTwbx succeeds with no warnings AND the validator agrees', () => {
    const goodHtml = '<!doctype html><html><body><script>render([1,2,3]);</script></body></html>';
    const built = buildTwbx({ ...base, html: goodHtml });
    expect(built.warnings).toEqual([]);
    expect(built.bytes.byteLength).toBeGreaterThan(0);

    const v = validate({ ...base, html: goodHtml });
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
  });

  it('the referenced-but-missing-asset hole is buildTwbx-side: builder succeeds with EMPTY warnings, but the validator flags it', () => {
    // The HTML references chart-lib.js which is NOT bundled. This is the exact class buildTwbx
    // cannot see (contentExtensionWarnings only inspects files that are PRESENT).
    const brokenHtml = '<!doctype html><script src="chart-lib.js"></script>';

    const built = buildTwbx({ ...base, html: brokenHtml });
    // Proof the hole exists and is buildTwbx-side: the build succeeds...
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    // ...and the builder emits NO warning about the missing asset.
    expect(built.warnings).toEqual([]);

    // The validator (buildTwbx + assetReferenceCheck) is what actually catches it.
    const v = validate({ ...base, html: brokenHtml });
    expect(v.ok).toBe(false);
    expect(v.warnings.some((w) => w.includes('chart-lib.js'))).toBe(true);
  });

  it('spec constant: an allowed extension (.js/.css/.png) produces NO extension warning', () => {
    expect(contentExtensionWarnings({ 'app.js': strToU8('x') })).toEqual([]);
    expect(contentExtensionWarnings({ 'theme.css': strToU8('x') })).toEqual([]);
    expect(contentExtensionWarnings({ 'logo.png': strToU8('x') })).toEqual([]);
  });

  it('spec constant: an unknown extension (.parquet) produces an extension warning', () => {
    const warnings = contentExtensionWarnings({ 'data.parquet': strToU8('x') });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('data.parquet');

    // And it surfaces through the full validator round-trip too.
    const v = validate({
      ...base,
      html: '<!doctype html><title>hi</title>',
      assets: [{ path: 'data.parquet', bytes: strToU8('x') }],
    });
    expect(v.ok).toBe(false);
    expect(v.warnings.some((w) => w.includes('data.parquet'))).toBe(true);
  });

  it('spec constant: an oversize input pushes an over-64MB message (does not throw)', () => {
    // Incompressible random bytes just over the limit so the zip stays above MAX_SINGLE_REQUEST_BYTES.
    const bigBytes = new Uint8Array(randomBytes(MAX_SINGLE_REQUEST_BYTES + 1024 * 1024));
    const v = validate({
      ...base,
      html: '<!doctype html><title>hi</title>',
      assets: [{ path: 'big.png', bytes: bigBytes }],
    });
    expect(v.byteLength).toBeGreaterThan(MAX_SINGLE_REQUEST_BYTES);
    expect(v.ok).toBe(false);
    expect(v.warnings.some((w) => w.includes('64 MB'))).toBe(true);
  });
});
