/**
 * Pre-state for the run-flow / run-flow-task signed confirmation tokens: a fingerprint of the flow's
 * most recent runs, so a confirm is rejected when a NEW run appeared between the preview and the
 * confirm — e.g. someone else started the flow, or the same preview was already confirmed on
 * another replica.
 *
 * WHY A SMALL WINDOW, NOT "PAGE SIZE 1": the Get Flow Runs endpoint floats rows whose sort key is
 * EMPTY to the front under `:desc`, in an unstable order (see listFlowRuns.ts). A brand-new run has
 * no `completedAt` (and a Pending run has no `startedAt` either), so it lands in that empty band.
 * With `completedAt:desc` the band is normally tiny (live-observed: a single row), so the new run
 * is inside the first FLOW_RUN_PRE_STATE_WINDOW rows. Fingerprinting the window as an
 * order-independent SET of run ids (sorted client-side) means an unstable order inside the band
 * cannot cause a spurious mismatch; only a change in membership can. A pageSize of 1
 * would fingerprint whichever empty-band row the server happened to return first, which could both
 * miss a new run and spuriously reject.
 *
 * Residual weakness (documented): when more than FLOW_RUN_PRE_STATE_WINDOW runs of this flow have an
 * empty `completedAt` (many queued / in-progress / never-completed runs), a new run may fall outside
 * the window and go undetected, and the unstable band order may spuriously reject a confirm. Both
 * degrade toward the token's other bindings (site, user, tool, target, parameters, TTL); neither
 * can wrongly authorize a different change.
 *
 * IDS ONLY, NOT STATUS: an existing run progressing (Pending -> InProgress -> Success) between the
 * preview and the confirm is not a new run and must not reject the confirm; only a new run id does.
 * (Status was fingerprinted originally, which spuriously rejected confirms while a prior run was
 * still finishing.) A run completing can still move a row out of / into the window — that changes
 * membership and rejects, which degrades safely (re-preview).
 *
 * FAIL CLOSED: any lookup error propagates to the caller (no token is minted on preview; nothing
 * runs on confirm). It never degrades to a stateless token. A 401/403 is rethrown as
 * ConfirmationPreStateForbiddenError naming `tableau:flow_runs:read` (see preStateRead.ts) so a
 * token consented before the scope was required gets "reconnect to grant it", not the generic
 * "not the flow owner / Prep Conductor" text from mapFlowWriteError.
 *
 * Cost: one Get Flow Runs call (pageSize FLOW_RUN_PRE_STATE_WINDOW) on preview AND on confirm.
 * Scope: `tableau:flow_runs:read`.
 */
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { readPreState } from '../_lib/preStateRead.js';

export const FLOW_RUN_PRE_STATE_WINDOW = 10;
export const FLOW_RUNS_READ_SCOPE = 'tableau:flow_runs:read';
const PRE_STATE_SORT = 'completedAt:desc';

/** Deterministic state string for `flowId`'s newest runs (see module comment). Throws on failure. */
export async function resolveFlowRunPreState(restApi: RestApi, flowId: string): Promise<string> {
  const runs = await readPreState(
    () =>
      restApi.flowsMethods.getFlowRuns({
        siteId: restApi.siteId,
        filter: `flowId:eq:${flowId}`,
        sort: PRE_STATE_SORT,
        pageSize: FLOW_RUN_PRE_STATE_WINDOW,
        pageNumber: 1,
      }),
    { description: "this flow's recent runs", requiredScopes: [FLOW_RUNS_READ_SCOPE] },
  );
  const fingerprint = runs
    .map((run) => run.id)
    .sort()
    .join(',');
  return JSON.stringify({ flowId, runs: fingerprint });
}
