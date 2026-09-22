import {
  apiVersionAtLeast,
  WORKBOOK_DIAGNOSTICS_MIN_API_VERSION,
} from '../externalApi/apiVersion.js';
import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import type { WorkbookDiagnostics, WorksheetInvalidField } from '../externalApi/types.js';
import type { ReadbackVerificationResult, VerificationFinding } from './readback-verify.js';

export type UsedFieldValidityOutcome =
  | { status: 'valid'; worksheetId: string }
  | {
      status: 'invalid';
      worksheetId: string;
      invalidFields: WorksheetInvalidField[];
      incompleteMessage?: string;
    }
  | {
      status: 'unknown';
      worksheetId?: string;
      reason: string;
      message: string;
    };

export async function checkUsedFieldValidity({
  executor,
  worksheetId,
  expectedInstanceId,
  signal,
  diagnostics,
  diagnosticsInvalid = false,
}: {
  executor: ExternalApiToolExecutor;
  worksheetId: string;
  expectedInstanceId: string;
  signal: AbortSignal;
  diagnostics?: WorkbookDiagnostics;
  diagnosticsInvalid?: boolean;
}): Promise<UsedFieldValidityOutcome> {
  const actualInstanceId = executor.desktopInstanceId;
  if (!actualInstanceId) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'instance-unavailable',
      message: 'Field verification could not confirm the current Desktop instance.',
    };
  }
  if (actualInstanceId !== expectedInstanceId) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'instance-mismatch',
      message: `Field verification expected Desktop instance ${expectedInstanceId}, but found ${actualInstanceId}.`,
    };
  }
  if (!apiVersionAtLeast(executor.desktopApiVersion, WORKBOOK_DIAGNOSTICS_MIN_API_VERSION)) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'unsupported-api',
      message: `Field verification requires External Client API ${WORKBOOK_DIAGNOSTICS_MIN_API_VERSION} or newer.`,
    };
  }

  if (diagnosticsInvalid) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'diagnostics-invalid',
      message: 'Field verification was unavailable because Desktop returned malformed diagnostics.',
    };
  }
  if (diagnostics !== undefined) {
    return diagnosticsOutcome(diagnostics, worksheetId);
  }

  let result;
  try {
    result = await executor.getWorksheetDiagnostics(worksheetId, signal, expectedInstanceId);
  } catch (error) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'validation-read-failed',
      message: `Field verification could not be read after the edit: ${formatExecutorError(error)}`,
    };
  }
  if (result.isErr()) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'validation-read-failed',
      message: `Field verification could not be read after the edit: ${formatExecutorError(result.error)}`,
    };
  }
  return diagnosticsOutcome(result.value, worksheetId);
}

function diagnosticsOutcome(
  diagnostics: WorkbookDiagnostics,
  worksheetId: string,
): UsedFieldValidityOutcome {
  const matches = diagnostics.worksheets.filter((item) => item.worksheetId === worksheetId);
  if (matches.length !== 1) {
    return {
      status: 'unknown',
      worksheetId,
      reason: matches.length === 0 ? 'diagnostics-target-missing' : 'diagnostics-target-ambiguous',
      message:
        matches.length === 0
          ? `Desktop diagnostics did not include the applied worksheet ${worksheetId}.`
          : `Desktop diagnostics included the applied worksheet ${worksheetId} more than once.`,
    };
  }
  const worksheet = matches[0];
  const invalidFields = worksheet.invalidFields ?? [];
  if (invalidFields.length > 0) {
    return {
      status: 'invalid',
      worksheetId,
      invalidFields,
      ...(worksheet.status !== 'complete'
        ? {
            incompleteMessage:
              worksheet.message ?? 'Desktop checked only part of the worksheet diagnostics.',
          }
        : {}),
    };
  }
  if (worksheet.status === 'unavailable') {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'diagnostics-unavailable',
      message: worksheet.message ?? 'Desktop reported that worksheet diagnostics were unavailable.',
    };
  }

  if (worksheet.status === 'partial') {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'diagnostics-partial',
      message:
        worksheet.message ??
        'Desktop checked only part of the worksheet diagnostics; no invalid fields were reported in the checked subset.',
    };
  }
  return { status: 'valid', worksheetId };
}

function formatExecutorError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const value = error as { type?: string; error?: unknown };
  if (typeof value.error === 'string') return value.error;
  if (value.error && typeof value.error === 'object' && 'message' in value.error) {
    return String((value.error as { message: unknown }).message);
  }
  return value.type ?? 'unknown validation read error';
}

export function mergeUsedFieldValidityVerification(
  structural: ReadbackVerificationResult | undefined,
  outcome: UsedFieldValidityOutcome,
): ReadbackVerificationResult {
  const scopeNote =
    'Static validation checks fields used by the worksheet; it does not verify query execution or rendering.';
  if (outcome.status === 'valid') {
    const message = `Static validation found no invalid used fields. ${scopeNote}`;
    return structural
      ? {
          ...structural,
          message: structural.message ? `${structural.message} ${message}` : message,
        }
      : { ok: true, status: 'passed', message };
  }

  if (outcome.status === 'invalid') {
    const findings: VerificationFinding[] = outcome.invalidFields.map((field) => ({
      severity: 'error',
      source: 'used-field-validity',
      message: `${field.fieldCaption ?? field.fieldName}: ${field.reason}`,
      worksheetId: outcome.worksheetId,
      fieldName: field.fieldName,
      ...(field.fieldCaption ? { fieldCaption: field.fieldCaption } : {}),
      shelf: field.shelf,
      marksSpecificationId: field.marksSpecificationId,
      encodingType: field.encodingType,
      reason: field.reason,
    }));
    if (outcome.incompleteMessage) {
      findings.push({
        severity: 'warning',
        source: 'used-field-validity',
        message: outcome.incompleteMessage,
        worksheetId: outcome.worksheetId,
        reason: 'diagnostics-partial',
      });
    }
    const message =
      'The edit was applied, but Desktop found invalid fields used by the worksheet. Diagnose the listed fields; do not automatically replay the edit.';
    return {
      ok: false,
      status: 'failed',
      message: `${structural?.message ? `${structural.message} ` : ''}${message} ${scopeNote}`,
      findings: [...(structural?.findings ?? []), ...findings],
    };
  }

  const unavailable: VerificationFinding = {
    severity: 'warning',
    source: 'used-field-validity',
    message: outcome.message,
    ...(outcome.worksheetId ? { worksheetId: outcome.worksheetId } : {}),
    reason: outcome.reason,
  };
  return {
    ok: structural?.status === 'failed' ? false : true,
    status: structural?.status === 'failed' ? 'failed' : 'skipped',
    message: `${structural?.message ? `${structural.message} ` : ''}${outcome.message} ${scopeNote}`,
    findings: [...(structural?.findings ?? []), unavailable],
  };
}
