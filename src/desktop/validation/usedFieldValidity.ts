import {
  apiVersionAtLeast,
  WORKSHEET_FIELD_VALIDATION_MIN_API_VERSION,
} from '../externalApi/apiVersion.js';
import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import type { WorksheetFieldValidation } from '../externalApi/types.js';
import type { ReadbackVerificationResult, VerificationFinding } from './readback-verify.js';

export type UsedFieldValidityOutcome =
  | { status: 'valid'; worksheetId: string }
  | ({ status: 'invalid' } & WorksheetFieldValidation)
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
}: {
  executor: ExternalApiToolExecutor;
  worksheetId: string;
  expectedInstanceId: string;
  signal: AbortSignal;
}): Promise<UsedFieldValidityOutcome> {
  if (!apiVersionAtLeast(executor.desktopApiVersion, WORKSHEET_FIELD_VALIDATION_MIN_API_VERSION)) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'unsupported-api',
      message: `Field verification requires External Client API ${WORKSHEET_FIELD_VALIDATION_MIN_API_VERSION} or newer.`,
    };
  }

  let result;
  try {
    result = await executor.getWorksheetFieldValidation(worksheetId, signal, expectedInstanceId);
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
  if (result.value.worksheetId !== worksheetId) {
    return {
      status: 'unknown',
      worksheetId,
      reason: 'target-mismatch',
      message: `Field verification returned worksheet ${result.value.worksheetId}, not the applied worksheet ${worksheetId}.`,
    };
  }
  return result.value.invalidFields.length === 0
    ? { status: 'valid', worksheetId: result.value.worksheetId }
    : { status: 'invalid', ...result.value };
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
