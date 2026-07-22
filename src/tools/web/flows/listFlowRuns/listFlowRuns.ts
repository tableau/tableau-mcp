import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { BoundedContext } from '../../../../overridableConfig.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { FlowRun } from '../../../../sdks/tableau/types/flow.js';
import { WebMcpServer } from '../../../../server.web.js';
import {
  LIST_FLOW_RUNS_FAILURE_INSIGHT_API_SCOPE,
  LIST_FLOW_RUNS_PRIMARY_API_SCOPES,
} from '../../../../server/oauth/scopes.js';
import { getHttpStatus } from '../../../../utils/getHttpStatus.js';
import { genericFilterDescription } from '../../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../../tool.js';
import { TableauWebRequestHandlerExtra } from '../../toolContext.js';
import { extractEqValue, looksLikeUuid } from '../flowFilterUtils.js';
import { buildTruncationInfo, ListFlowsTruncationReason } from '../listFlows/listFlows.js';
import { parseAndValidateFlowRunsFilterString } from './flowRunsFilterUtils.js';

// Server page size for the run-history pagination loop. The "Get Flow Runs"
// endpoint returns NO pagination block (no `totalAvailable`), so this tool
// cannot use paginateWithMetadata. Instead it walks pages until a short page
// (server exhausted) or it has collected one more match than the caller asked
// for (the "+1 probe", which lets it report `truncated` without a count).
const FLOW_RUNS_PAGE_SIZE = 100;

// Sentinel for "no caller limit and no admin cap" — pagination still terminates
// at the server's last (short) page, so this just means "return everything".
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

// The Get Flow Runs endpoint was introduced in REST API 3.10 (Tableau Server
// 2020.4). Older servers return 404, so gate the call to give a clear message.
const MIN_REST_VERSION = '3.10';

// Safety backstop for an otherwise-unbounded call (no caller `limit` AND no admin
// MAX_RESULT_LIMIT). Flow runs accumulate quickly on active sites, so default to
// the newest N rather than walking the entire history page by page (which would
// load the server and could be very slow). Reported via `truncationReason:
// 'default-cap'` so the caller knows more exist and can request them.
const DEFAULT_FLOW_RUNS_LIMIT = 100;

/**
 * Truncation reasons for list-flow-runs. Extends the shared list-flows reasons
 * with `'default-cap'` — unique to this tool — for when the safety backstop
 * (rather than a caller `limit` or admin cap) bound the result.
 */
export type ListFlowRunsTruncationReason = ListFlowsTruncationReason | 'default-cap';

export type ListFlowRunsResultInfo = {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListFlowRunsTruncationReason;
};

/**
 * Pointer to investigate flow-run failures in the Tableau UI. The Get Flow Runs
 * endpoint never returns *why* a run failed, so when the returned window holds
 * one or more `Failed` runs the tool resolves ONE affected flow's `webpageUrl`
 * (via Query Flow) into a run-history deep link the caller can open to read the
 * error. Only one example is resolved (a single extra REST call); `failedFlowCount`
 * tells the caller how many other flows failed so it can offer to fetch their
 * links (via get-flow) on request.
 */
export type ListFlowRunsFailureInsight = {
  // Number of `Failed` runs within the returned (post-limit) window.
  failedRunCount: number;
  // Number of DISTINCT flows with at least one `Failed` run in that window.
  failedFlowCount: number;
  // One example, present only when the flow's `webpageUrl` could be resolved:
  // the most-recent failure's flow and its run-history page.
  example?: {
    flowId: string;
    runHistoryUrl: string;
  };
};

/**
 * Wrapped result: `flowRuns` is the (possibly truncated) array and
 * `mcp.resultInfo` (always present) reports whether that array is complete.
 *
 * Unlike list-flows there is no `totalAvailable` — the Get Flow Runs endpoint
 * does not return a server-side count, so completeness is reported via the
 * `truncated` flag (computed with a "+1 probe") only.
 *
 * `mcp.failureInsight` is present ONLY when the returned window contains a
 * `Failed` run (the API hides failure reasons, so this links to the UI page).
 */
export type ListFlowRunsResult = {
  flowRuns: FlowRun[];
  mcp: {
    resultInfo: ListFlowRunsResultInfo;
    failureInsight?: ListFlowRunsFailureInsight;
  };
};

const paramsSchema = {
  filter: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().int().positive().optional(),
};

export const getListFlowRunsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listFlowRunsTool = new WebTool({
    server,
    name: 'list-flow-runs',
    disabled: !config.flowToolsEnabled,
    description: `
  Retrieves the run history (executions) of Tableau Prep flows on a site. Each flow run records one execution attempt with its \`status\` (Pending, InProgress, Success, Failed, Cancelled), \`startedAt\`/\`completedAt\` timestamps, \`progress\`, the \`flowId\` it belongs to, and the \`backgroundJobId\`. Use this tool to answer questions about flow execution outcomes — e.g. "which flows failed recently", "show the run history for flow X", "what's still running".

  **This vs. get-flow / list-flows**
  - \`list-flows\` lists flow *definitions* (metadata), not executions.
  - \`get-flow\` returns recent runs for ONE flow (capped, as a sidecar). \`list-flow-runs\` is the dedicated, filterable, site-wide run history — use it for cross-flow questions ("all failures today") or deeper single-flow history.

  **What a run record does NOT include**
  - **Failure reason:** a run reports only its \`status\`, never *why* it failed — the run data carries no error message. A failed run's \`backgroundJobId\` identifies the underlying background job that holds the error detail, but reading that detail requires Tableau **site-administrator** access. \`backgroundJobId\` is populated only for recent runs. As a workaround, when the returned window contains \`Failed\` runs the tool resolves a **run-history deep link** for one affected flow into \`mcp.failureInsight\` — open it in Tableau to read the error there (see Response Shape).
  - **Trigger origin:** a run does not record whether it was started by a *schedule* or *ad-hoc / on-demand*, and there is no field to filter scheduled-only runs. To see which flows have schedules, use \`list-flow-tasks\`.

  **Caller-role visibility**
  - **Non-admin** callers get runs only for flows they can *run* — flows on which they hold the **Execute** ("Run Flow Now") capability (as owner, via an explicit or group grant, or inherited from the project). A flow the caller can only *view* (Read) but not run returns NO runs here. NOTE: this is stricter than the Tableau web UI's run-history page (which needs only view permission), so a user may see a flow's runs in the browser yet get nothing for that flow from this tool.
  - **Admin** callers (site or server) get runs for every flow on the site, so \`mcp.resultInfo.truncated\` is more likely \`true\` on a broad call.

  **Response Shape**
  Returns a JSON object \`{ flowRuns: [...], mcp: { resultInfo: {...} } }\`. \`mcp.resultInfo\` is ALWAYS present and reports completeness:
  - \`returnedCount\` — number of runs in \`flowRuns\`.
  - \`truncated\` — \`false\` means \`flowRuns\` is the COMPLETE set matching the request; \`true\` means more matching runs exist on the server than were returned.
  - \`truncationReason\` (only when \`truncated\` is \`true\`):
      - \`"requested-limit"\` — your \`limit\` cut the result short; call again with a higher \`limit\` for more.
      - \`"default-cap"\` — you supplied no \`limit\` and no admin cap is set, so the tool returned the newest ${DEFAULT_FLOW_RUNS_LIMIT} runs as a safety default (flow runs can be very numerous); pass a higher \`limit\` and/or a narrower \`filter\` to get more.
      - \`"admin-cap"\` — a site-administrator per-call cap (\`MAX_RESULT_LIMIT[S]\`) cut it short; narrow the \`filter\` (e.g. a tighter \`startedAt\` window or a single \`flowId\`) or ask an admin to raise the cap.
  - There is NO \`totalAvailable\` — the Tableau Flow Runs endpoint does not return a total count. When \`truncated\` is \`true\`, report "at least N" (never invent a total).
  - \`mcp.failureInsight\` (present ONLY when the returned window contains at least one \`Failed\` run): a pointer to investigate failures in the Tableau UI, since the API does not expose the error message. Fields:
      - \`failedRunCount\` — number of \`Failed\` runs in the returned window.
      - \`failedFlowCount\` — number of DISTINCT flows with a failure in that window.
      - \`example\` (when resolvable) — \`{ flowId, runHistoryUrl }\` for ONE affected flow (the most-recent failure); open \`runHistoryUrl\` in a browser and expand the failed run to read why it failed.

  **Reporting to the user (every call):** translate \`mcp.resultInfo\` into one plain sentence — never say "resultInfo". \`truncated:false\` → "these are all N matching runs". \`"requested-limit"\` → "here are N; more match — say if you want the rest". \`"default-cap"\` → "here are the newest N; more runs exist — say if you want a larger set (or narrow by flow/date)". \`"admin-cap"\` → "here are N; a site limit caps results per call — I can narrow the search, or an admin can raise the cap". When \`mcp.failureInsight\` is present, also note that the API can't return the failure reason but it is viewable in Tableau, and share \`example.runHistoryUrl\`; if \`failedFlowCount\` > 1, add that this link is for one of N affected flows and offer to fetch the others (resolve each via \`get-flow\`). Also surface the **Caller-role visibility** limit when presenting results: these runs cover ONLY flows the user can *run* (the Execute / "Run Flow Now" capability), not flows they can only view — so a flow they can see in the Tableau web UI may be missing here. Call this out especially on empty or unexpectedly short results, or when the user asks for "all" failures. (Site/server administrators are exempt — they get runs for every flow, so do not state this limit to an admin caller.)

  **Response-Size Guidance** — flow runs accumulate quickly on active sites, so favour narrow calls:
  - Single-flow history: \`filter: "flowId:eq:<uuid>"\` (+ optional \`limit\`).
  - Recent failures: \`filter: "status:eq:Failed,startedAt:gt:2025-01-01"\`.
  - With no \`limit\` and no admin cap, the tool returns the newest ${DEFAULT_FLOW_RUNS_LIMIT} runs (\`truncated:true\`, \`truncationReason:"default-cap"\`) instead of the full history; pass a higher \`limit\` to go deeper.

  **Supported Filter Fields and Operators**
  | Field       | Operators            | Notes |
  |-------------|----------------------|-------|
  | flowId      | eq, in               | Flow LUID (UUID). Most common filter — scope runs to one or more flows. |
  | userId      | eq, in               | LUID of the user who initiated the run. |
  | progress    | eq, gt, gte, lt, lte | Percent complete (0–100). |
  | startedAt   | eq, gt, gte, lt, lte | ISO 8601 \`YYYY-MM-DDTHH:MM:SSZ\`, OR date-only \`YYYY-MM-DD\` (auto-promoted to midnight UTC). |
  | completedAt | eq, gt, gte, lt, lte | ISO 8601 \`YYYY-MM-DDTHH:MM:SSZ\`, OR date-only \`YYYY-MM-DD\` (auto-promoted to midnight UTC). |
  | status      | eq, in               | One of Pending, InProgress, Success, Failed, Cancelled. **Applied client-side** (the Tableau API does not filter runs by status server-side), so it is matched against the runs fetched for the rest of the filter — pair it with \`flowId\` and/or a \`startedAt\` window for precise results. |

  **Filter value contracts** (mismatches return 0 runs):
  - \`flowId\` must be the flow UUID; a flow name (or any id that doesn't resolve to a visible flow) returns no runs and the tool hints toward list-flows.
  - \`status\` values are case-sensitive and must be one of the five exact values above; an unknown value is rejected with the allowed list.
  - \`in:\` lists use bracket/comma form, e.g. \`flowId:in:[uuid1,uuid2]\` or \`status:in:[Failed,Cancelled]\` (unquoted; commas inside items unsupported).

  ${genericFilterDescription}

  **Sort Expression**
  - Default (no \`sort\`): newest first by run recency — ordered by \`completedAt\`, falling back to \`startedAt\` for runs that haven't completed; runs with neither timestamp (e.g. \`Pending\`) sort last. This is a best-effort "most recent" within the returned window.
  - Override with an explicit \`sort\`, e.g. \`completedAt:desc\` or \`startedAt:asc\`. NOTE: the Tableau API orders runs whose chosen field is empty FIRST under \`:desc\`, so an explicit \`startedAt:desc\` surfaces never-started runs (e.g. some Cancelled) ahead of genuinely recent ones — prefer the default for "latest runs".

  **Example Usage:**
  - Run history for one flow, newest first: filter: "flowId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3"
  - Recent failures across all flows: filter: "status:eq:Failed,startedAt:gt:2025-01-01"
  - In-progress runs right now: filter: "status:eq:InProgress"`,
    paramsSchema,
    annotations: {
      title: 'List Flow Runs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, sort, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validated = filter ? parseAndValidateFlowRunsFilterString(filter) : undefined;
      const serverFilter = validated?.serverFilter ?? '';
      const matchesStatus = validated?.matchesStatus ?? ((): boolean => true);

      return await listFlowRunsTool.logAndExecute<ListFlowRunsResult>({
        extra,
        args: { filter, sort, limit },
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: LIST_FLOW_RUNS_PRIMARY_API_SCOPES,
              callback: async (restApi) => {
                if (!RestApi.versionIsAtLeast(MIN_REST_VERSION)) {
                  throw new Error(
                    `Listing flow runs requires Tableau REST API version ${MIN_REST_VERSION} or later (Tableau Server 2020.4 / Tableau Cloud). The connected Tableau server does not support the Get Flow Runs endpoint.`,
                  );
                }

                const maxResultLimit = configWithOverrides.getMaxResultLimit(listFlowRunsTool.name);
                // Resolve the effective cap. An explicit caller `limit` wins (still
                // capped by any admin MAX_RESULT_LIMIT); else the admin cap; else the
                // DEFAULT_FLOW_RUNS_LIMIT backstop so a no-argument call never walks
                // the entire run history.
                const usedDefaultBackstop = limit === undefined && !maxResultLimit;
                const effectiveLimit = limit
                  ? maxResultLimit
                    ? Math.min(maxResultLimit, limit)
                    : limit
                  : (maxResultLimit ?? DEFAULT_FLOW_RUNS_LIMIT);

                let collected: { items: FlowRun[]; truncatedByLimit: boolean };
                try {
                  collected = await collectFlowRuns({
                    effectiveLimit,
                    matchesStatus,
                    // With no caller `sort`, return the newest runs by recency.
                    // The Get Flow Runs endpoint floats rows whose sort key is
                    // EMPTY to the front under `:desc`, and `startedAt` is empty
                    // for every Cancelled-before-start run (live-observed 600+ in
                    // a row), so the old `startedAt:desc` default returned a stale,
                    // unordered block of never-started runs as the "newest N".
                    // `completedAt:desc` has a far smaller empty band (live-observed
                    // a single row) so the genuinely recent runs land inside the
                    // fetched window; `sortByRecency` then re-orders that window by
                    // `completedAt ?? startedAt` (see collectFlowRuns). An explicit
                    // caller `sort` is passed through and honored as-is.
                    sortByRecency: sort === undefined,
                    pageSize: FLOW_RUNS_PAGE_SIZE,
                    getPage: (pageNumber) =>
                      restApi.flowsMethods.getFlowRuns({
                        siteId: restApi.siteId,
                        filter: serverFilter,
                        sort: sort ?? 'completedAt:desc',
                        pageSize: FLOW_RUNS_PAGE_SIZE,
                        pageNumber,
                      }),
                  });
                } catch (error) {
                  // The Get Flow Runs endpoint returns 404 (not an empty list)
                  // when a `flowId` filter does not resolve to a real flow the
                  // caller can see — confirmed against Tableau Cloud for both a
                  // non-UUID value and a valid-format-but-nonexistent UUID. Turn
                  // that into an empty result so the caller gets the actionable
                  // recovery hint (see buildEmptyMessage) instead of a bare
                  // "Request failed with status code 404". Only swallow the 404
                  // when a flowId clause is present; any other 404 is unexpected
                  // and should surface.
                  if (
                    serverFilter.includes('flowId') &&
                    error instanceof Error &&
                    getHttpStatus(error) === '404'
                  ) {
                    return {
                      flowRuns: [],
                      mcp: { resultInfo: { returnedCount: 0, truncated: false } },
                    } satisfies ListFlowRunsResult;
                  }
                  throw error;
                }

                const { items: flowRuns, truncatedByLimit } = collected;

                const { truncated, truncationReason } = buildTruncationInfo({
                  truncatedByLimit,
                  maxResultLimit,
                  llmLimit: limit,
                  effectiveLimit,
                });
                // The shared helper only knows 'admin-cap' / 'requested-limit'. When
                // our backstop (not a caller limit or admin cap) was the binding
                // constraint, label it 'default-cap' so the distinction is clear.
                const finalTruncationReason: ListFlowRunsTruncationReason | undefined =
                  truncated && usedDefaultBackstop ? 'default-cap' : truncationReason;

                // If the window holds any Failed runs, resolve a UI run-history
                // link for one of them (the API can't tell the caller WHY a run
                // failed). Computed unconditionally here; constrainFlowRuns drops
                // it on the empty / bounded-context paths so the gate stays in one
                // place. Best-effort — see buildFailureInsight.
                const failureInsight = await buildFailureInsight({ flowRuns, extra });

                return {
                  flowRuns,
                  mcp: {
                    resultInfo: {
                      returnedCount: flowRuns.length,
                      truncated,
                      ...(finalTruncationReason && { truncationReason: finalTruncationReason }),
                    },
                    ...(failureInsight && { failureInsight }),
                  },
                } satisfies ListFlowRunsResult;
              },
            }),
          );
        },
        constrainSuccessResult: (result) =>
          constrainFlowRuns({
            result,
            boundedContext: configWithOverrides.boundedContext,
            validatedFilter: validated?.normalizedFilter,
          }),
      });
    },
  });

  return listFlowRunsTool;
};

/**
 * Recency timestamp (epoch ms) for ordering runs newest-first under the default
 * sort. A run's recency is its `completedAt`, falling back to `startedAt` when it
 * hasn't completed. Runs with NEITHER timestamp (e.g. `Pending`) have no knowable
 * recency and sort LAST (`-Infinity`). An unparseable timestamp is treated the
 * same as missing.
 */
function recencyMillis(run: FlowRun): number {
  const ts = run.completedAt ?? run.startedAt;
  if (!ts) {
    return Number.NEGATIVE_INFINITY;
  }
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Newest-first comparator on `completedAt ?? startedAt`, nulls last. Equal keys
 * (including two never-dated runs) compare 0 so the stable sort preserves the
 * server's relative order for ties.
 */
function compareByRecencyDesc(a: FlowRun, b: FlowRun): number {
  const ka = recencyMillis(a);
  const kb = recencyMillis(b);
  return ka === kb ? 0 : kb - ka;
}

/**
 * When the returned window contains one or more `Failed` runs, build a pointer
 * the caller can use to investigate WHY in the Tableau UI — the Get Flow Runs
 * endpoint never returns an error message. We resolve ONE example failed flow's
 * `webpageUrl` (via the Query Flow endpoint) and turn it into a run-history deep
 * link (`webpageUrl + "/runHistory"`); that page lists the flow's runs and lets
 * the user expand a failed run to read its error. Only one flow is resolved (the
 * most-recent failure in the window) to keep this to a single extra REST call —
 * `failedFlowCount` tells the caller how many other flows failed so it can offer
 * to fetch their links (via get-flow) on request.
 *
 * Returns `undefined` when the window has no failures. Best-effort otherwise: any
 * failure to resolve the example link is swallowed (the runs are the primary
 * result and must not be lost over a missing sidecar URL), so `example` may be
 * absent even when failures exist.
 */
async function buildFailureInsight({
  flowRuns,
  extra,
}: {
  flowRuns: FlowRun[];
  extra: TableauWebRequestHandlerExtra;
}): Promise<ListFlowRunsFailureInsight | undefined> {
  const failedRuns = flowRuns.filter((run) => run.status === 'Failed');
  if (failedRuns.length === 0) {
    return undefined;
  }

  const failedFlowIds = new Set(
    failedRuns.map((run) => run.flowId).filter((id): id is string => id !== undefined),
  );

  // The window is ordered newest-first (default sort), so the first failed run
  // with a flowId is the most-recent failure — the best single example.
  const exampleFlowId = failedRuns.find((run) => run.flowId !== undefined)?.flowId;

  let example: ListFlowRunsFailureInsight['example'];
  if (exampleFlowId !== undefined) {
    try {
      const { flow } = await useRestApi({
        ...extra,
        jwtScopes: [LIST_FLOW_RUNS_FAILURE_INSIGHT_API_SCOPE],
        callback: async (restApi) => {
          return await restApi.flowsMethods.queryFlow({
            siteId: restApi.siteId,
            flowId: exampleFlowId,
          });
        },
      });
      if (flow.webpageUrl) {
        example = {
          flowId: exampleFlowId,
          // `webpageUrl` is the flow's UI page in numeric-id form
          // (e.g. .../#/site/<site>/flows/<id>); its run-history tab is that
          // page + "/runHistory" (matches what the Tableau UI links to).
          runHistoryUrl: `${flow.webpageUrl.replace(/\/+$/, '')}/runHistory`,
        };
      }
    } catch {
      // Best-effort: a failed link resolution must not fail the whole call.
    }
  }

  return {
    failedRunCount: failedRuns.length,
    failedFlowCount: failedFlowIds.size,
    ...(example && { example }),
  };
}

/**
 * Walk the Get Flow Runs pages, applying the client-side `status` predicate as
 * it goes, until either the server is exhausted (a short page) or one more match
 * than `effectiveLimit` has been collected (the "+1 probe"). Returns the
 * limit-capped items plus whether more matching runs exist server-side.
 *
 * When `sortByRecency` is set (the default-sort path), the collected window is
 * re-ordered newest-first by `completedAt ?? startedAt` BEFORE the limit slice,
 * which corrects the endpoint's empty-key-first ordering (see callback). For an
 * explicit caller `sort` the server order is preserved.
 */
async function collectFlowRuns({
  getPage,
  matchesStatus,
  effectiveLimit,
  pageSize,
  sortByRecency,
}: {
  getPage: (pageNumber: number) => Promise<FlowRun[]>;
  matchesStatus: (run: FlowRun) => boolean;
  effectiveLimit: number;
  pageSize: number;
  sortByRecency: boolean;
}): Promise<{ items: FlowRun[]; truncatedByLimit: boolean }> {
  const probeTarget = effectiveLimit === UNBOUNDED ? UNBOUNDED : effectiveLimit + 1;
  const matched: FlowRun[] = [];
  // De-duplicate across pages by run id. The Get Flow Runs endpoint paginates
  // with an UNSTABLE order whenever the sort key is empty or tied — many runs
  // have no `completedAt` (InProgress/Pending) or no `startedAt`
  // (Cancelled-before-start) — so the same run can be returned on more than one
  // page. Without this guard the repeats leak into the result (live-observed:
  // 150 requested -> 10 duplicate ids) and inflate the +1 probe.
  const seenIds = new Set<string>();
  let pageNumber = 1;

  for (;;) {
    const page = await getPage(pageNumber);
    let newThisPage = 0;
    for (const run of page) {
      if (run.id !== undefined) {
        if (seenIds.has(run.id)) {
          continue; // duplicate from an overlapping page — skip
        }
        seenIds.add(run.id);
      }
      newThisPage++;
      if (matchesStatus(run)) {
        matched.push(run);
      }
    }

    // Stop when: the server has no more runs (a short page); enough matches were
    // collected (incl. the +1 probe); or a full page yielded NO new runs at all,
    // which means the server is only re-returning rows we've already seen (a
    // degenerate unstable-pagination loop) and further pages cannot make progress.
    if (page.length < pageSize || matched.length >= probeTarget || newThisPage === 0) {
      break;
    }
    pageNumber++;
  }

  // Re-order the fetched window newest-first before slicing so the limit keeps
  // the most-recent runs (not whichever empty-key rows the server floated up).
  if (sortByRecency) {
    matched.sort(compareByRecencyDesc);
  }

  const truncatedByLimit = matched.length > effectiveLimit;
  const items = effectiveLimit === UNBOUNDED ? matched : matched.slice(0, effectiveLimit);
  return { items, truncatedByLimit };
}

export function constrainFlowRuns({
  result,
  boundedContext,
  validatedFilter,
}: {
  // Tolerates a missing `mcp.resultInfo` (treated as "complete") so unit tests
  // can pass a bare `{ flowRuns }`.
  result: {
    flowRuns: FlowRun[];
    mcp?: { resultInfo?: ListFlowRunsResultInfo; failureInsight?: ListFlowRunsFailureInsight };
  };
  boundedContext: BoundedContext;
  validatedFilter?: string;
}): ConstrainedResult<ListFlowRunsResult> {
  // Fail closed: a flow run carries no project or tag, so when the server is
  // restricted to a PROJECT_IDS / TAGS bounded context we cannot prove a run
  // belongs to the allowed set. Refuse rather than risk leaking runs for flows
  // outside the allow-list. (Other bounded-context dimensions —
  // datasource/workbook/view — do not constrain flows, mirroring list-flows.)
  const { projectIds, tags } = boundedContext;
  if (projectIds || tags) {
    return {
      type: 'empty',
      message: [
        'The set of content that can be queried is limited by the server configuration (an allowed-projects or tags bounded context is active).',
        'Flow runs are not associated with a project or tag, so this tool cannot verify that a run belongs to the allowed set and does not return flow runs under this configuration.',
        'To inspect a specific allowed flow\u2019s run history, use the get-flow tool with the flow id (it enforces the same bounded context on the flow itself).',
      ].join(' '),
    };
  }

  if (result.flowRuns.length === 0) {
    return {
      type: 'empty',
      message: buildEmptyMessage(validatedFilter),
    };
  }

  const truncated = result.mcp?.resultInfo?.truncated ?? false;
  const truncationReason = result.mcp?.resultInfo?.truncationReason;
  const failureInsight = result.mcp?.failureInsight;

  return {
    type: 'success',
    result: {
      flowRuns: result.flowRuns,
      mcp: {
        resultInfo: {
          returnedCount: result.flowRuns.length,
          truncated,
          ...(truncationReason && { truncationReason }),
        },
        ...(failureInsight && { failureInsight }),
      },
    },
  };
}

/**
 * Build the empty-result message, optionally including a recovery hint when the
 * filter contains a `flowId:eq:<value>` clause whose value is not a UUID. The
 * Get Flow Runs endpoint responds 404 (not an empty list) for a flowId that
 * isn't a real, visible flow LUID — e.g. when an LLM passes a flow *name*. The
 * callback converts that 404 into this empty result, so the hint turns an
 * otherwise-cryptic 404 into a recoverable signal.
 */
function buildEmptyMessage(validatedFilter: string | undefined): string {
  const baseline =
    'No flow runs were found. Either none exist, none match the filter, or you lack permission — non-admins only receive runs for flows they can run (the Execute / "Run Flow Now" capability), not flows they can only view.';

  const flowIdValue = extractEqValue(validatedFilter, 'flowId');
  if (flowIdValue && !looksLikeUuid(flowIdValue)) {
    return [
      baseline,
      '',
      `Hint: the \`flowId\` filter you supplied (\`${flowIdValue}\`) is not a UUID. The Tableau Flow Runs REST API matches \`flowId\` against the flow's LUID (8-4-4-4-12 hex form); any other value (e.g. a flow name) does not resolve to a flow and returns no runs.`,
      '',
      'To recover:',
      '1. Look up the flow id by name with the `list-flows` tool (`filter: name:eq:<flow name>`) and read `id` from the response, then re-run with `flowId:eq:<uuid>`, OR',
      '2. Re-run `list-flow-runs` without the `flowId` filter to see recent runs across all flows you can access (each run includes its `flowId`).',
    ].join('\n');
  }

  return baseline;
}

export const exportedForTesting = {
  listFlowRunsParamsSchema: paramsSchema,
  collectFlowRuns,
};
