/**
 * Scope-aware wrapper for the pre-state reads behind signed confirmation / approval tokens
 * (W-25002517).
 *
 * run-flow, run-flow-task and update-cloud-extract-refresh-task hash a live read of the target into
 * their token (the flow's newest runs, the task's flow, the task's current schedule). Those reads
 * need API scopes the tools did not require before, so an OAuth token consented earlier is refused
 * by Tableau with a 401/403. Left alone that surfaces as a misleading message (for flows, "not the
 * flow owner / Prep Conductor"; for tasks, a generic "Permission denied"). This wrapper turns a
 * 401/403 from the read into a ConfirmationPreStateForbiddenError that names the scope and says to
 * reconnect.
 *
 * FAIL CLOSED: every error is still thrown. Only the 401/403 message changes. Other errors (404,
 * network, 5xx) propagate unchanged so the callers' existing mapping still applies. There is no
 * fallback to a token without pre-state.
 */
import { ConfirmationPreStateForbiddenError } from '../../../errors/mcpToolError.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getHttpStatusCode } from '../../../utils/getHttpStatus.js';

export async function readPreState<T>(
  read: () => Promise<T>,
  {
    description,
    requiredScopes,
  }: {
    /** What the read fetches, for the message, e.g. "this flow's recent runs". */
    description: string;
    requiredScopes: ReadonlyArray<string>;
  },
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw toPreStateReadError(error, { description, requiredScopes });
  }
}

/** Maps a 401/403 from a pre-state read to ConfirmationPreStateForbiddenError; returns any other error unchanged. */
export function toPreStateReadError(
  error: unknown,
  { description, requiredScopes }: { description: string; requiredScopes: ReadonlyArray<string> },
): unknown {
  // An already-typed error (e.g. from a nested pre-state read) keeps its own message.
  if (error instanceof ConfirmationPreStateForbiddenError) {
    return error;
  }
  const status = getHttpStatusCode(error);
  if (status === 401 || status === 403) {
    return new ConfirmationPreStateForbiddenError({
      description,
      requiredScopes,
      statusCode: status,
      cause: getExceptionMessage(error),
    });
  }
  return error;
}
