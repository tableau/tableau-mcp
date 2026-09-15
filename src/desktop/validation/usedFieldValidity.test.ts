import { Ok } from 'ts-results-es';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { classifyWorksheetPromiseOutcome } from './promise-check.js';
import type { ReadbackVerificationResult } from './readback-verify.js';
import {
  checkUsedFieldValidity,
  mergeUsedFieldValidityVerification,
  type UsedFieldValidityOutcome,
} from './usedFieldValidity.js';

describe('used-field validity verification', () => {
  const scopeNote =
    'Static validation checks fields used by the worksheet; it does not verify query execution or rendering.';
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
    expect(report.message).toContain(scopeNote);
    expect(report.message).toContain('do not automatically replay the edit');
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
    expect(report.message).toContain(structuralWarning.message);
    expect(report.message).toContain(
      'Field verification requires External Client API 0.2.16 or newer.',
    );
    expect(report.message).toContain(scopeNote);
    expect(report.message).not.toContain('found no invalid used fields');
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
    const structuralFinding = {
      severity: 'warning' as const,
      source: 'readback' as const,
      message: 'Readback did not run.',
    };
    const report = mergeUsedFieldValidityVerification(
      {
        ok: true,
        status: 'skipped',
        message: 'Readback unavailable.',
        findings: [structuralFinding],
      },
      { status: 'valid', worksheetId: 'sheet-1' },
    );

    expect(report).toMatchObject({ ok: true, status: 'skipped' });
    expect(report.message).toContain('Readback unavailable.');
    expect(report.message).toContain('Static validation found no invalid used fields.');
    expect(report.message).toContain(scopeNote);
    expect(report.findings).toEqual([structuralFinding]);
  });

  it.each([
    ['valid', { status: 'valid', worksheetId: 'sheet-1' }, 1],
    [
      'invalid',
      {
        status: 'invalid',
        worksheetId: 'sheet-1',
        invalidFields: [
          {
            fieldName: '[none:Missing:nk]',
            shelf: 'rows',
            marksSpecificationId: 'marks-1',
            encodingType: 'text',
            reason: 'Field is unavailable.',
          },
        ],
      },
      2,
    ],
    [
      'unknown',
      {
        status: 'unknown',
        worksheetId: 'sheet-1',
        reason: 'validation-read-failed',
        message: 'Native validation read failed exactly.',
      },
      2,
    ],
  ] satisfies [string, UsedFieldValidityOutcome, number][])(
    'preserves failed structural evidence when native validation is %s',
    (_name, outcome, expectedFindingCount) => {
      const structural: ReadbackVerificationResult = {
        ok: false,
        status: 'failed',
        message: 'Structural readback failed exactly.',
        findings: [{ severity: 'error', source: 'readback', message: 'A shelf was dropped.' }],
      };

      const report = mergeUsedFieldValidityVerification(structural, outcome);

      expect(report).toMatchObject({ ok: false, status: 'failed' });
      expect(report.message).toContain(structural.message);
      expect(report.message).toContain(scopeNote);
      expect(report.findings).toEqual(expect.arrayContaining(structural.findings ?? []));
      expect(report.findings).toHaveLength(expectedFindingCount);
    },
  );

  it('returns unknown instead of throwing when the best-effort post-check throws', async () => {
    const executor = {
      desktopInstanceId: 'instance-1',
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
      desktopInstanceId: 'instance-1',
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

  it('reports a replaced Desktop instance before an older API version', async () => {
    const getWorksheetFieldValidation = vi.fn();
    const executor = {
      desktopInstanceId: 'instance-replacement',
      desktopApiVersion: '0.2.15',
      getWorksheetFieldValidation,
    } as unknown as ExternalApiToolExecutor;

    const outcome = await checkUsedFieldValidity({
      executor,
      worksheetId: 'sheet-1',
      expectedInstanceId: 'instance-original',
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      status: 'unknown',
      worksheetId: 'sheet-1',
      reason: 'instance-mismatch',
    });
    expect(getWorksheetFieldValidation).not.toHaveBeenCalled();
  });

  it('distinguishes missing Desktop identity from a compatible instance', async () => {
    const getWorksheetFieldValidation = vi.fn();
    const executor = {
      desktopApiVersion: '0.2.16',
      getWorksheetFieldValidation,
    } as unknown as ExternalApiToolExecutor;

    const outcome = await checkUsedFieldValidity({
      executor,
      worksheetId: 'sheet-1',
      expectedInstanceId: 'instance-original',
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      status: 'unknown',
      worksheetId: 'sheet-1',
      reason: 'instance-unavailable',
    });
    expect(getWorksheetFieldValidation).not.toHaveBeenCalled();
  });
});
