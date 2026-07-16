import { describe, expect, it } from 'vitest';

import {
  formatDashboardPromiseCheck,
  formatWorkbookPromiseCheck,
  formatWorksheetPromiseCheck,
} from './promise-check.js';
import type { ValidationIssue } from './types.js';

const warning = (): ValidationIssue => ({ ruleId: 'x', severity: 'warning', message: 'w' });

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
