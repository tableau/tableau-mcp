import { Ok } from 'ts-results-es';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { classifyWorksheetPromiseOutcome } from './promise-check.js';
import type { ReadbackVerificationResult } from './readback-verify.js';
import { checkUsedFieldValidity, mergeUsedFieldValidityVerification } from './usedFieldValidity.js';

describe('used-field validity verification', () => {
  const structuralWarning: ReadbackVerificationResult = {
    ok: true,
    status: 'warning',
    message: 'One structural warning.',
    findings: [
      {
        severity: 'warning',
        source: 'readback',
        message: 'A non-critical formatting node changed.',
      },
    ],
  };

  it('adds authoritative invalid-field findings without calling the applied edit a failure', () => {
    const report = mergeUsedFieldValidityVerification(undefined, {
      status: 'invalid',
      worksheetId: 'sheet-1',
      invalidFields: [
        {
          fieldName: '[none:Sales:qk]',
          fieldCaption: 'Sales',
          shelf: 'rows',
          marksSpecificationId: 'marks-1',
          encodingType: 'text',
          reason: 'The field is unavailable.',
        },
      ],
    });

    expect(report).toMatchObject({ ok: false, status: 'failed' });
    expect(report.findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        source: 'used-field-validity',
        fieldName: '[none:Sales:qk]',
        fieldCaption: 'Sales',
        worksheetId: 'sheet-1',
        shelf: 'rows',
        marksSpecificationId: 'marks-1',
        encodingType: 'text',
        reason: 'The field is unavailable.',
      }),
    ]);
  });

  it('preserves structural findings while making an unavailable native check unverified', () => {
    const report = mergeUsedFieldValidityVerification(structuralWarning, {
      status: 'unknown',
      worksheetId: 'sheet-1',
      reason: 'unsupported-api',
      message: 'Field verification requires External Client API 0.2.16 or newer.',
    });

    expect(report.status).toBe('skipped');
    expect(report.findings).toEqual([
      structuralWarning.findings?.[0],
      expect.objectContaining({
        severity: 'warning',
        source: 'used-field-validity',
        reason: 'unsupported-api',
      }),
    ]);
    expect(
      classifyWorksheetPromiseOutcome({
        validationWarnings: [],
        readback: report,
      }),
    ).toBe('unverified');
  });

  it('does not upgrade skipped structural readback when native validation is clean', () => {
    const report = mergeUsedFieldValidityVerification(
      { ok: true, status: 'skipped', message: 'Readback unavailable.' },
      { status: 'valid', worksheetId: 'sheet-1' },
    );

    expect(report).toMatchObject({ ok: true, status: 'skipped' });
  });

  it('returns unknown instead of throwing when the best-effort post-check throws', async () => {
    const executor = {
      desktopApiVersion: '0.2.16',
      getWorksheetFieldValidation: vi.fn().mockRejectedValue(new Error('discovery failed')),
    } as unknown as ExternalApiToolExecutor;

    const outcome = await checkUsedFieldValidity({
      executor,
      worksheetId: 'sheet-1',
      expectedInstanceId: 'instance-1',
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      status: 'unknown',
      worksheetId: 'sheet-1',
      reason: 'validation-read-failed',
    });
  });

  it('returns unknown when Desktop responds for a different worksheet id', async () => {
    const executor = {
      desktopApiVersion: '0.2.16',
      getWorksheetFieldValidation: vi.fn().mockResolvedValue(
        Ok({
          worksheetId: 'wrong-sheet',
          invalidFields: [],
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const outcome = await checkUsedFieldValidity({
      executor,
      worksheetId: 'sheet-1',
      expectedInstanceId: 'instance-1',
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      status: 'unknown',
      worksheetId: 'sheet-1',
      reason: 'target-mismatch',
    });
  });
});
