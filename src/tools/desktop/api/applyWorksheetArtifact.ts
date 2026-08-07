import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/executorTypes.js';
import {
  type TemplateArtifactReserveResult,
  type TemplateArtifactStore,
  type TemplateArtifactUnavailableReason,
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
    const result = await loadWorksheetXml({
      worksheetName: reservation.artifact.title,
      xml: reservation.artifact.worksheetXml,
      focus: { navigate: 'artifact', sheetName: reservation.artifact.title },
      executor,
      signal,
      artifactApply: {
        windowXml: reservation.artifact.windowXml,
        expectedTargetState: reservation.artifact.targetState,
        expectedInstanceId: reservation.artifact.instanceId,
        dispatchState,
      },
    });
    finalize();

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
        artifactId,
        title: reservation.artifact.title,
        verification: result.value.readbackVerification ?? {
          ok: true,
          status: 'skipped',
          message: 'Post-apply workbook readback was unavailable.',
        },
      },
    };
  } catch (error) {
    finalize();
    throw error;
  }
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
