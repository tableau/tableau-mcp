import { describe, expect, it } from 'vitest';

import {
  classifyWorksheetPromiseOutcome,
  formatDashboardPromiseCheck,
  formatWorkbookPromiseCheck,
  formatWorksheetPromiseCheck,
} from './promise-check.js';
import type { ReadbackFinding } from './readback-verify.js';
import type { ValidationIssue } from './types.js';

const warning = (): ValidationIssue => ({ ruleId: 'x', severity: 'warning', message: 'w' });
const sortWarning = (
  node: 'computed-sort' | 'shelf-sort-v2',
  readback: 'missing' | 'changed' = 'missing',
): ReadbackFinding => ({
  kind: 'sort',
  node,
  column: '[DS].[none:State:nk]',
  intended: `<${node} column="[DS].[none:State:nk]">`,
  readback,
  severity: 'warning',
});

describe('promise check receipt (W-23447506)', () => {
  it('classifies worksheet promise outcomes with formatter parity', () => {
    expect(
      classifyWorksheetPromiseOutcome({
        validationWarnings: [],
        readback: { ok: true, status: 'passed' },
      }),
    ).toBe('verified');
    expect(
      classifyWorksheetPromiseOutcome({
        validationWarnings: [],
        readback: { ok: true, status: 'skipped' },
      }),
    ).toBe('unverified');
    expect(
      classifyWorksheetPromiseOutcome({
        validationWarnings: [],
        readback: { ok: false, status: 'failed' },
      }),
    ).toBe('failed');
    expect(
      classifyWorksheetPromiseOutcome({
        validationWarnings: [],
        readback: { ok: true, status: 'warning' },
        readbackFindings: [sortWarning('computed-sort')],
      }),
    ).toBe('failed');
  });

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

  it('escalates promised computed-sort loss from warning to failed', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [sortWarning('computed-sort')],
    });

    expect(text).toContain('HOST VERIFICATION — failed');
    expect(text).toContain('promised sort NOT verified');
    expect(text).not.toContain('HOST VERIFICATION — verified');
  });

  it('escalates promised shelf-sort-v2 loss from warning to failed', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [sortWarning('shelf-sort-v2', 'changed')],
    });

    expect(text).toContain('HOST VERIFICATION — failed');
    expect(text).toContain('promised sort NOT verified');
    expect(text).not.toContain('HOST VERIFICATION — verified');
  });

  it('keeps non-sort readback warnings verified', () => {
    const text = formatWorksheetPromiseCheck({
      validationWarnings: [],
      readback: { ok: true, status: 'warning' },
      readbackFindings: [
        {
          kind: 'mark',
          node: 'mark',
          intended: '<mark class="Bar">',
          readback: 'changed',
          severity: 'warning',
        },
      ],
    });

    expect(text).toContain('HOST VERIFICATION — verified');
    expect(text).not.toContain('promised sort NOT verified');
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
