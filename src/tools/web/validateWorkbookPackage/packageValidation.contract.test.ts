import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DataAppSnapshot } from '../../../dataApps/types.js';
import { checkUnder64Mb, MAX_SINGLE_REQUEST_BYTES } from '../_lib/publishShared.js';
import { contentExtensionWarnings } from '../createAndPublishWorkbook/buildTwbx.js';
import {
  buildWorkspaceTwbx,
  listPackagedWorkspaceFiles,
} from '../createAndPublishWorkbook/buildWorkspaceTwbx.js';
import { assetReferenceCheck } from './assetReferenceCheck.js';

// Drift guard. These assertions pin the CONTRACT between the real workspace builder
// (buildWorkspaceTwbx + contentExtensionWarnings) and validate-workbook-package's added checks
// (assetReferenceCheck + checkUnder64Mb). If any builder constant/behavior changes, this must break
// so the change is a deliberate decision. It exercises the SAME pure composition the tool uses,
// without a store.

const options = { packageId: 'com.example.myviz', workbookName: 'My Viz' };

function snapshot(files: Record<string, string | Uint8Array>): DataAppSnapshot {
  const entries = Object.entries(files)
    .map(([path, content]) => ({
      path,
      content: typeof content === 'string' ? new TextEncoder().encode(content) : content,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { appId: 'a'.repeat(32), files: entries, digest: 'd', createdAt: new Date() };
}

// The validator's effective policy expressed against the REAL builder + checks. Advisory extension
// warnings never flip ok; hard reference/size failures do. Mirrors validateWorkbookPackage.ts.
function validate(snap: DataAppSnapshot): {
  ok: boolean;
  warnings: string[];
  byteLength: number;
  wouldIssueReceipt: boolean;
} {
  const { bytes, warnings: advisory } = buildWorkspaceTwbx(snap, options);
  const referenceWarnings = assetReferenceCheck(listPackagedWorkspaceFiles(snap));
  const sizeError = checkUnder64Mb(bytes.byteLength);
  const hard = [...referenceWarnings, ...(sizeError ? [sizeError.getErrorText()] : [])];
  const wouldIssueReceipt = hard.length === 0;
  return {
    ok: wouldIssueReceipt,
    warnings: [...advisory, ...hard],
    byteLength: bytes.byteLength,
    wouldIssueReceipt,
  };
}

describe('package validation contract (drift guard)', () => {
  it('a self-contained good snapshot: builder succeeds with no warnings AND the validator agrees', () => {
    const snap = snapshot({
      'index.html': '<!doctype html><html><body><script>render([1,2,3]);</script></body></html>',
      'dataapp.json': '{}',
    });
    const built = buildWorkspaceTwbx(snap, options);
    expect(built.warnings).toEqual([]);
    expect(built.bytes.byteLength).toBeGreaterThan(0);

    const v = validate(snap);
    expect(v.ok).toBe(true);
    expect(v.wouldIssueReceipt).toBe(true);
    expect(v.warnings).toEqual([]);
  });

  it('the referenced-but-missing-asset hole is builder-side: buildWorkspaceTwbx succeeds with EMPTY warnings, but the validator flags it', () => {
    const snap = snapshot({
      'index.html': '<!doctype html><script src="chart-lib.js"></script>',
      'dataapp.json': '{}',
    });
    const built = buildWorkspaceTwbx(snap, options);
    // Proof the hole is builder-side: the build succeeds and emits NO warning about the missing asset.
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(built.warnings).toEqual([]);

    const v = validate(snap);
    expect(v.ok).toBe(false);
    expect(v.wouldIssueReceipt).toBe(false);
    expect(v.warnings.some((w) => w.includes('chart-lib.js'))).toBe(true);
  });

  it('dataapp.json is not packaged, so it is never scanned or shipped as content', () => {
    const packaged = listPackagedWorkspaceFiles(
      snapshot({ 'index.html': '<html></html>', 'dataapp.json': '{}' }),
    );
    expect(packaged.map((f) => f.path)).toEqual(['index.html']);
  });

  it('spec constant: an allowed extension (.js/.css/.png) produces NO extension warning', () => {
    expect(contentExtensionWarnings({ 'app.js': new TextEncoder().encode('x') })).toEqual([]);
    expect(contentExtensionWarnings({ 'theme.css': new TextEncoder().encode('x') })).toEqual([]);
    expect(contentExtensionWarnings({ 'logo.png': new TextEncoder().encode('x') })).toEqual([]);
  });

  it('advisory policy: an unknown extension (.parquet) warns but STILL issues a receipt', () => {
    const snap = snapshot({
      'index.html': '<!doctype html><title>hi</title>',
      'data.parquet': 'x',
      'dataapp.json': '{}',
    });
    const v = validate(snap);
    // Advisory extension warning present...
    expect(v.warnings.some((w) => w.includes('data.parquet'))).toBe(true);
    // ...but it does NOT block the receipt (ok stays true).
    expect(v.ok).toBe(true);
    expect(v.wouldIssueReceipt).toBe(true);
  });

  it('hard policy: an oversize snapshot pushes an over-64MB message and blocks the receipt (does not throw)', () => {
    const bigBytes = new Uint8Array(randomBytes(MAX_SINGLE_REQUEST_BYTES + 1024 * 1024));
    const snap = snapshot({
      'index.html': '<!doctype html><title>hi</title>',
      'big.png': bigBytes,
      'dataapp.json': '{}',
    });
    const v = validate(snap);
    expect(v.byteLength).toBeGreaterThan(MAX_SINGLE_REQUEST_BYTES);
    expect(v.ok).toBe(false);
    expect(v.wouldIssueReceipt).toBe(false);
    expect(v.warnings.some((w) => w.includes('64 MB'))).toBe(true);
  });

  it('placeholder/trivial HTML is structurally valid but the digest only certifies bytes, not correctness', () => {
    // A near-empty index.html assembles into a valid, under-limit package: structure/size/reference
    // checks all pass. That is exactly why checksPerformed enumerates ONLY structural checks — a
    // green result never asserts visual/business correctness.
    const snap = snapshot({
      'index.html': '<!doctype html><title>placeholder</title>',
      'dataapp.json': '{}',
    });
    const v = validate(snap);
    expect(v.ok).toBe(true);
    const digest = createHash('sha256')
      .update(buildWorkspaceTwbx(snap, options).bytes)
      .digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
