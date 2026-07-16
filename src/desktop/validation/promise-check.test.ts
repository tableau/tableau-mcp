import { describe, expect, it } from 'vitest';

import {
  formatDashboardPromiseCheck,
  formatWorkbookPromiseCheck,
  formatWorksheetPromiseCheck,
} from './promise-check.js';
import type { ReadbackFinding } from './readback-verify.js';
import type { ValidationIssue } from './types.js';

const warning = (): ValidationIssue => ({ ruleId: 'x', severity: 'warning', message: 'w' });

const SORT_COLUMN = '[DS].[none:State:nk]';

/** A readback sort finding for a submitted <computed-sort> (the promised sort). */
const computedSortFinding = (readback: 'missing' | 'changed'): ReadbackFinding => ({
  kind: 'sort',
  node: 'computed-sort',
  column: SORT_COLUMN,
  intended: `<computed-sort column="${SORT_COLUMN}" direction="DESC">`,
  readback,
  severity: 'warning',
});

describe('promise check receipt (W-23447506)', () => {
  it('formats clean readback as verified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'passed' },
    });
    expect(text).toContain('HOST VERIFICATION — verified');
    expect(text).toContain('readback clean');
    expect(text).toContain('do not report unlisted issues');
  });

  it('formats skipped readback as unverified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'skipped' },
    });
    expect(text).toContain('HOST VERIFICATION — unverified');
    expect(text).toContain('readback unavailable');
    expect(text).toContain('Do not claim the change is confirmed');
  });

  it('formats missing readback as unverified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [warning()],
      readback: undefined,
    });
    expect(text).toContain('unverified');
    expect(text).toContain('preflight 1 warning(s)');
  });

  it('formats failed readback as failed', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: false, status: 'failed' },
    });
    expect(text).toContain('HOST VERIFICATION — failed');
    expect(text).toContain('readback FAILED');
  });

  it('formats workbook applies as honestly unverified', () => {
    const text = formatWorkbookPromiseCheck([]);
    expect(text).toContain('HOST VERIFICATION — unverified');
    expect(text).toContain('full workbook intent NOT re-verified');
  });

  it('formats dashboard applies as honestly unverified', () => {
    const text = formatDashboardPromiseCheck([]);
    expect(text).toContain('full dashboard intent NOT re-verified');
  });
});

describe('promise check — promised-sort honesty (W66 item 4)', () => {
  // (a) submitted-with-sort + readback-lost-sort → receipt NOT "verified".
  it('dropped promised computed-sort → failed, never verified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [computedSortFinding('missing')],
    });
    expect(text).not.toContain('HOST VERIFICATION — verified');
    expect(text).toContain('HOST VERIFICATION — failed');
    expect(text).toContain('promised sort NOT verified');
    expect(text).toContain('Do not claim the change is confirmed');
  });

  it('changed promised computed-sort → failed, never verified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [computedSortFinding('changed')],
    });
    expect(text).toContain('HOST VERIFICATION — failed');
    expect(text).not.toContain('HOST VERIFICATION — verified');
  });

  // (b) submitted-without-a-promised-sort + sort drift → unchanged (verified).
  it('incidental shelf-sort drift (no promised computed-sort) stays verified', () => {
    const drift: ReadbackFinding = {
      kind: 'sort',
      node: 'shelf-sort-v2',
      column: SORT_COLUMN,
      intended: `<shelf-sort-v2 column="${SORT_COLUMN}">`,
      readback: 'changed',
      severity: 'warning',
    };
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [drift],
    });
    expect(text).toContain('HOST VERIFICATION — verified');
    expect(text).not.toContain('promised sort NOT verified');
  });

  it('no sort findings at all → unchanged warning→verified behavior', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [],
    });
    expect(text).toContain('HOST VERIFICATION — verified');
  });

  // (c) sort intact → verified as today.
  it('clean readback with intact sort → verified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'passed' },
      readbackFindings: [],
    });
    expect(text).toContain('HOST VERIFICATION — verified');
  });
});
