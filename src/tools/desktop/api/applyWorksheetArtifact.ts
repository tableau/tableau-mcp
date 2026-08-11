import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/executorTypes.js';
import {
  type TemplateArtifactReserveResult,
  type TemplateArtifactStore,
  type TemplateArtifactUnavailableReason,
  type TemplateWorksheetArtifact,
} from '../../../desktop/templates/templateArtifactStore.js';
import type { ReadbackVerificationResult } from '../../../desktop/validation/readback-verify.js';
import { loadWorksheetXml } from '../../../desktop/wrappers/loadWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  McpToolError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';

export interface ApplyWorksheetArtifactArgs {
  store: TemplateArtifactStore;
  artifactId: string;
  sessionId: string;
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  reservation?: Extract<TemplateArtifactReserveResult, { ok: true }>;
}

export interface ArtifactApplyReceipt {
  artifactId: string;
  title: string;
  verification: ReadbackVerificationResult;
}

export interface ApplyWorksheetArtifactPayloadArgs {
  artifact: Readonly<TemplateWorksheetArtifact>;
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  dispatchState?: { attempted: boolean };
}

export type WorksheetArtifactOutcome =
  | { state: 'applied'; retrySafe: false; receipt: ArtifactApplyReceipt }
  | { state: 'failed'; retrySafe: true; error: McpToolError }
  | { state: 'unknown'; retrySafe: false; error: McpToolError };

export async function applyWorksheetArtifact({
  store,
  artifactId,
  sessionId,
  executor,
  signal,
  reservation: suppliedReservation,
}: ApplyWorksheetArtifactArgs): Promise<WorksheetArtifactOutcome> {
  const reservation = suppliedReservation ?? store.reserve(artifactId, sessionId);
  if (!reservation.ok) {
    return {
      state: 'failed',
      retrySafe: true,
      error: templateArtifactUnavailableError(artifactId, reservation.reason),
    };
  }

  const dispatchState = { attempted: false };
  let finalized = false;
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    if (dispatchState.attempted) store.consume(reservation.lease);
    else store.release(reservation.lease);
  };

  try {
    const outcome = await applyWorksheetArtifactPayload({
      artifact: reservation.artifact,
      executor,
      signal,
      dispatchState,
    });
    finalize();
    if (outcome.state !== 'applied') return outcome;
    return { ...outcome, receipt: { ...outcome.receipt, artifactId } };
  } catch (error) {
    finalize();
    throw error;
  }
}

export async function applyWorksheetArtifactPayload({
  artifact,
  executor,
  signal,
  dispatchState = { attempted: false },
}: ApplyWorksheetArtifactPayloadArgs): Promise<WorksheetArtifactOutcome> {
  const result = await loadWorksheetXml({
    worksheetName: artifact.title,
    xml: artifact.worksheetXml,
    focus: { navigate: 'artifact', sheetName: artifact.title },
    executor,
    signal,
    artifactApply: {
      windowXml: artifact.windowXml,
      expectedTargetState: artifact.targetState,
      expectedInstanceId: artifact.instanceId,
      dispatchState,
    },
  });

  if (result.isErr()) {
    const error = toMcpToolError(result.error, dispatchState.attempted);
    return dispatchState.attempted
      ? { state: 'unknown', retrySafe: false, error }
      : { state: 'failed', retrySafe: true, error };
  }

  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      artifactId: artifact.id,
      title: artifact.title,
      verification: result.value.readbackVerification ?? {
        ok: true,
        status: 'skipped',
        message: 'Post-apply workbook readback was unavailable.',
      },
    },
  };
}

function toMcpToolError(
  error:
    | {
        type: 'execute-command-error';
        error: ConstructorParameters<typeof DesktopCommandExecutionError>[0];
      }
    | {
        type: 'load-worksheet-xml-error';
        error: ConstructorParameters<typeof WorksheetXmlLoadFailedError>[0];
      },
  dispatchAttempted: boolean,
): McpToolError {
  if (error.type === 'execute-command-error') {
    return new DesktopCommandExecutionError(
      error.error,
      dispatchAttempted
        ? 'The artifact may have reached Desktop and was consumed. Do not retry it; build a fresh artifact after inspecting the workbook.'
        : undefined,
    );
  }
  return new WorksheetXmlLoadFailedError(error.error);
}

export function templateArtifactUnavailableError(
  artifactId: string,
  reason: TemplateArtifactUnavailableReason,
): McpToolError {
  return new McpToolError({
    type: 'template-artifact-unavailable',
    message: artifactUnavailableMessage(artifactId, reason),
    statusCode: 409,
  });
}

function artifactUnavailableMessage(
  artifactId: string,
  reason: TemplateArtifactUnavailableReason,
): string {
  switch (reason) {
    case 'in-use':
      return `Template artifact "${artifactId}" is already being applied.`;
    case 'session-mismatch':
      return `Template artifact "${artifactId}" belongs to a different Desktop session.`;
    case 'consumed':
      return `Template artifact "${artifactId}" was already consumed. Build a fresh artifact.`;
    case 'evicted':
      return `Template artifact "${artifactId}" was evicted. Build a fresh artifact.`;
    case 'unknown':
      return `Template artifact "${artifactId}" is not available.`;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
