import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../../../overridableConfig.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { Flow } from '../../../../sdks/tableau/types/flow.js';
import { WebMcpServer } from '../../../../server.web.js';
import { paginateWithMetadata } from '../../../../utils/paginate.js';
import { genericFilterDescription } from '../../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../../tool.js';
import {
  extractOwnerNameEqValue,
  extractProjectIdEqValue,
  looksLikeLoginNotFullName,
  looksLikeUuid,
  parseAndValidateFlowsFilterString,
} from './flowsFilterUtils.js';

/**
 * Why a list-flows result was cut short. Only set when `truncated` is `true`.
 *
 * - `'requested-limit'` — the caller's own `limit` argument bound the result.
 *   More flows match; calling again with a higher `limit` (or omitting it)
 *   returns more.
 * - `'admin-cap'` — the operator-configured `MAX_RESULT_LIMIT` (or
 *   `MAX_RESULT_LIMITS=list-flows:N`) bound the result, AND the caller did not
 *   ask for an equal-or-smaller `limit` itself. The `limit` argument cannot
 *   exceed this cap, so the matching set must be narrowed (filter) or the cap
 *   raised by an administrator.
 */
export type ListFlowsTruncationReason = 'requested-limit' | 'admin-cap';

/**
 * Completeness status attached to EVERY successful list-flows response.
 *
 * `truncated === false` means `flows` is the COMPLETE set matching the request
 * (every flow the caller can see, subject to any `filter`). `truncated === true`
 * means more matching flows exist on the server than were returned.
 *
 * This is a deliberate, always-present *positive* signal in both directions.
 * The earlier design only emitted a warning when the admin cap truncated the
 * result, which (a) left the model to infer completeness from the *absence* of
 * a signal — so it leaked meta-commentary like "no warning, so this is
 * everything" to users — and (b) gave no signal at all when the model's own
 * `limit` truncated the result (the common case), so partial lists were
 * reported as complete.
 */
export type ListFlowsResultInfo = {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListFlowsTruncationReason;
  /**
   * Total flows Tableau reports for the query (all pages, ignoring `limit`).
   * Most useful when `truncated` is `true` — the model can say "showing 100 of
   * 430" instead of "at least 100".
   *
   * Present ONLY when no server-side bounded context (PROJECT_IDS/TAGS) is
   * configured: that count is taken before the tool's client-side allow-list
   * filtering, so under a bounded context it would overstate the accessible
   * total and is therefore omitted rather than risk misleading "N of M".
   */
  totalAvailable?: number;
};

/**
 * Wrapped tool result shape: `flows` is the (possibly truncated) array, and
 * `mcp.resultInfo` (always present) reports whether that array is complete.
 *
 * Wrapping the array is a deliberate choice over a bare `Flow[]` — it lets us
 * attach the completeness signal (and any future metadata) without another
 * shape break later.
 */
export type ListFlowsResult = {
  flows: Flow[];
  mcp: {
    resultInfo: ListFlowsResultInfo;
  };
};

const paramsSchema = {
  filter: z.string().optional(),
  sort: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListFlowsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listFlowsTool = new WebTool({
    server,
    name: 'list-flows',
    description: `
  Retrieves a list of Tableau Prep flows on a Tableau site, including each flow's metadata such as name, description, owner, project, tags, and timestamps. Supports optional filtering via field:operator:value expressions (e.g., name:eq:DailySalesCleanup) and sorting (e.g., createdAt:desc) for precise discovery. Use this tool when a user requests to list, search, or filter Tableau Prep flows on a site.

  **Caller-role visibility (important for sizing)**
  - **Non-admin** callers get only flows they can view — on shared sites usually far more than they own, so an unfiltered call is rarely "just my flows".
  - **Admin** callers get EVERY flow on the site (often thousands on enterprise sites), so \`mcp.resultInfo.truncated\` is much more likely \`true\` on the first call.

  **Response Shape**
  Returns a JSON object \`{ flows: [...], mcp: { resultInfo: {...} } }\`. The \`flows\` array contains one record per flow. \`mcp.resultInfo\` is ALWAYS present and tells you whether the returned list is complete:
  - \`returnedCount\` — number of flows in \`flows\`.
  - \`truncated\` — \`false\` means \`flows\` is the COMPLETE set matching the request (every flow the caller can see, subject to any \`filter\`). \`true\` means more matching flows exist on the server than were returned.
  - \`truncationReason\` (present only when \`truncated\` is \`true\`):
      - \`"requested-limit"\` — the \`limit\` you passed cut the result short. To get more, call again with a higher \`limit\` (or omit it).
      - \`"admin-cap"\` — a site-administrator per-call cap (\`MAX_RESULT_LIMIT[S]\`) cut the result short. \`limit\` cannot raise it, so either narrow the \`filter\` (by \`projectId\`, \`projectName\`, \`ownerName\`, or a tighter \`createdAt\`/\`updatedAt\` window) so the matching set fits, or ask the administrator to raise the cap.
  - \`totalAvailable\` (present only when no server-side allow-list is configured) — total flows matching the request on the server. When \`truncated\` is \`true\`, report "N of M" (e.g. "showing 100 of 430") instead of "at least N".

  **Reporting to the user (every call):** translate \`mcp.resultInfo\` into one plain sentence — never say "resultInfo"/"warnings". \`truncated:false\` → "these are all N matching flows". \`"requested-limit"\` → "here are the first N of M; more match — say if you want the rest". \`"admin-cap"\` → "here are the first N of M; a site limit caps results per call — I can narrow the search, or an admin can raise the cap" (use \`totalAvailable\` for M when present; otherwise say "at least N", never N as the total).

  **Response-Size Guidance** — favour narrow calls (each record includes project, owner, tags, and parameters):
  - **Targeted lookup** ("does flow X exist?"): pass \`filter\` + a small \`limit\` (e.g. 5).
  - **Scoped exploration** ("flows in the Finance project"): pass \`filter\` + a moderate \`limit\` (25–50).
  - **Broad analytics**: a moderate \`limit\` (e.g. 100); only omit \`limit\` when the user explicitly asks for the full/exhaustive set.

  **Supported Filter Fields and Operators**
  | Field       | Operators            | Notes |
  |-------------|----------------------|-------|
  | createdAt   | eq, gt, gte, lt, lte | ISO 8601 timestamp \`YYYY-MM-DDTHH:MM:SSZ\`, OR date-only \`YYYY-MM-DD\` (auto-promoted to midnight UTC) |
  | name        | eq, in               | Flow name (case-sensitive — pass exact case; whitespace-sensitive) |
  | ownerName   | eq                   | **Matches the user's display name (\`fullName\`), NOT login name or email.** See "ownerName semantics" below. |
  | projectId   | eq                   | Project UUID (most reliable owner-of-project filter) |
  | projectName | eq, in               | Project name (case-sensitive — pass exact case; whitespace-sensitive) |
  | updatedAt   | eq, gt, gte, lt, lte | ISO 8601 timestamp \`YYYY-MM-DDTHH:MM:SSZ\`, OR date-only \`YYYY-MM-DD\` (auto-promoted to midnight UTC) |

  **Filter value contracts (important)** — mismatches silently return 0 results with no error, so these matter:
  - **\`ownerName\`** matches the owner's \`fullName\` (display name) ONLY — not \`user.name\`/login/email or user id. It is the only owner filter (the API exposes no \`ownerEmail\`/\`ownerDomain\`/\`ownerId\`). Given an email or id, resolve the \`fullName\` first (Users REST API, or read \`owner.fullName\` from a prior response). On an empty result that looks like this mistake, the tool returns a recovery hint.
  - **\`projectId\`** must be the project UUID; any other value (including a project name) returns 0. On a non-UUID value the tool hints toward \`projectName:eq:<name>\`.
  - **\`name\`, \`projectName\`** are case- and whitespace-sensitive (per the Tableau REST spec) — pass the exact, trimmed value as it appears in Tableau.
  - **\`createdAt\`, \`updatedAt\`** accept full ISO 8601 with the \`Z\` suffix (\`2025-01-01T00:00:00Z\`) or date-only \`YYYY-MM-DD\` (promoted to midnight UTC). Locale forms (\`MM/DD/YYYY\`), no-timezone, and \`+00:00\` offsets are rejected client-side.
  - **\`in:\` lists** use bracket/comma form \`name:in:[Foo,Bar]\` — unquoted; commas inside items are unsupported (a Tableau limitation).

  ${genericFilterDescription}

  **Sort Expression**
  - Use the same field set as filtering, with \`:asc\` or \`:desc\` suffix (e.g., \`createdAt:desc\`).
  - Sort and filter can be combined.

  **Example Usage:**
  - List flows named "DailySalesCleanup": filter: "name:eq:DailySalesCleanup"
  - List flows in a project by id: filter: "projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3"
  - List flows updated after a date, newest first: filter: "updatedAt:gt:2025-01-01", sort: "updatedAt:desc"
  - List flows owned by a user (value MUST be the display name \`fullName\`, not login/email): filter: "ownerName:eq:Jane Doe"`,
    paramsSchema,
    annotations: {
      title: 'List Flows',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, sort, pageSize, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateFlowsFilterString(filter) : undefined;

      return await listFlowsTool.logAndExecute<ListFlowsResult>({
        extra,
        args: { filter, sort, pageSize, limit },
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listFlowsTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(listFlowsTool.name);
                const effectiveLimit = maxResultLimit
                  ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                  : limit;

                const {
                  items: flows,
                  totalAvailable,
                  truncatedByLimit,
                } = await paginateWithMetadata({
                  pageConfig: {
                    pageSize,
                    limit: effectiveLimit,
                  },
                  getDataFn: async (pageConfig) => {
                    const { pagination, flows: data } =
                      await restApi.flowsMethods.queryFlowsForSite({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        sort,
                        pageSize: pageConfig.pageSize,
                        pageNumber: pageConfig.pageNumber,
                      });

                    return { pagination, data };
                  },
                });

                const { truncated, truncationReason } = buildTruncationInfo({
                  truncatedByLimit,
                  maxResultLimit,
                  llmLimit: limit,
                  effectiveLimit,
                });

                return {
                  flows,
                  mcp: {
                    resultInfo: {
                      returnedCount: flows.length,
                      truncated,
                      ...(truncationReason && { truncationReason }),
                      totalAvailable,
                    },
                  },
                } satisfies ListFlowsResult;
              },
            }),
          );
        },
        constrainSuccessResult: (result) =>
          constrainFlows({
            result,
            boundedContext: configWithOverrides.boundedContext,
            validatedFilter,
          }),
      });
    },
  });

  return listFlowsTool;
};

export function constrainFlows({
  result,
  boundedContext,
  validatedFilter,
}: {
  // Input tolerates a missing `mcp.resultInfo` (treated as "complete") so unit
  // tests can call constrainFlows with a bare `{ flows }`. Production always
  // passes a fully-populated ListFlowsResult from the tool callback.
  result: { flows: Flow[]; mcp?: { resultInfo?: ListFlowsResultInfo } };
  boundedContext: BoundedContext;
  validatedFilter?: string;
}): ConstrainedResult<ListFlowsResult> {
  let flows = result.flows;

  if (flows.length === 0) {
    return {
      type: 'empty',
      message: buildEmptyMessage(validatedFilter),
    };
  }

  const { projectIds, tags } = boundedContext;
  if (projectIds) {
    flows = flows.filter((flow) => (flow.project?.id ? projectIds.has(flow.project.id) : false));
  }

  if (tags) {
    flows = flows.filter((flow) => flow.tags?.tag?.some((tag) => tags.has(tag.label)));
  }

  if (flows.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed flows that can be queried is limited by the server configuration.',
        'While flows were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  // `returnedCount` reflects the flows actually returned AFTER bounded-context
  // filtering. The `truncated`/`truncationReason` signal carries through
  // unchanged: it describes the server-side page loop (there are more flows in
  // Tableau, beyond the cap, that we never fetched and therefore could not
  // evaluate against the bounded context), which this filtering does not alter.
  const truncated = result.mcp?.resultInfo?.truncated ?? false;
  const truncationReason = result.mcp?.resultInfo?.truncationReason;

  // `totalAvailable` is Tableau's server-side count for the query, taken BEFORE
  // the bounded-context filtering above. Surface it only when no bounded context
  // is configured; otherwise it would overstate the accessible total (it counts
  // flows the allow-list may exclude), so omit it rather than mislead.
  const boundedContextActive = Boolean(projectIds || tags);
  const totalAvailable = boundedContextActive ? undefined : result.mcp?.resultInfo?.totalAvailable;

  return {
    type: 'success',
    result: {
      flows,
      mcp: {
        resultInfo: {
          returnedCount: flows.length,
          truncated,
          ...(truncationReason && { truncationReason }),
          ...(totalAvailable !== undefined && { totalAvailable }),
        },
      },
    },
  };
}

/**
 * Classify whether (and why) the page loop returned fewer flows than match the
 * request. Drives `mcp.resultInfo.truncated` / `truncationReason`.
 *
 *  - Not truncated (`truncatedByLimit === false`) → `{ truncated: false }`.
 *  - Truncated by the operator cap → `'admin-cap'`, but ONLY when the cap was
 *    the binding constraint AND the caller did not request an equal-or-smaller
 *    `limit` itself. If the caller asked for `limit: 10` while the cap is 100,
 *    the truncation was the caller's intent, so it is reported as
 *    `'requested-limit'`, not `'admin-cap'`.
 *  - Otherwise (the caller's own `limit` was binding, or there is no cap) →
 *    `'requested-limit'`.
 */
export function buildTruncationInfo({
  truncatedByLimit,
  maxResultLimit,
  llmLimit,
  effectiveLimit,
}: {
  truncatedByLimit: boolean;
  maxResultLimit: number | null;
  llmLimit: number | undefined;
  effectiveLimit: number | undefined;
}): { truncated: boolean; truncationReason?: ListFlowsTruncationReason } {
  if (!truncatedByLimit) {
    return { truncated: false };
  }

  const adminCapWasBinding =
    maxResultLimit !== null &&
    effectiveLimit === maxResultLimit &&
    (llmLimit === undefined || llmLimit > maxResultLimit);

  return {
    truncated: true,
    truncationReason: adminCapWasBinding ? 'admin-cap' : 'requested-limit',
  };
}

/**
 * Build the empty-result message, optionally including a recovery hint when the
 * supplied filter contains a clause with a value of the wrong shape for that
 * field. The Tableau Flows API silently returns 0 results in several cases that
 * are easy for an LLM to fall into:
 *
 *  - `ownerName:eq:<login or email or userId>` — the API matches `fullName` only
 *  - `projectId:eq:<non-uuid value>` — the API matches against the actual project
 *    id only and silently returns 0 for any non-existent or malformed value
 *
 * We turn these silent zeros into structured recovery messages so the LLM can
 * self-correct rather than reporting "you have 0 flows" when it actually had
 * the wrong identifier shape.
 */
function buildEmptyMessage(validatedFilter: string | undefined): string {
  const baseline =
    'No flows were found. Either none exist or you do not have permission to view them.';

  const ownerNameValue = extractOwnerNameEqValue(validatedFilter);
  if (ownerNameValue && looksLikeLoginNotFullName(ownerNameValue)) {
    return [
      baseline,
      '',
      `Hint: the \`ownerName\` filter you supplied (\`${ownerNameValue}\`) looks like a login, email, or user id, but the Tableau Flows REST API matches \`ownerName\` against the user's \`fullName\` (display name) only — it does NOT match \`user.name\`/login/email or user id.`,
      '',
      'To recover:',
      "1. Look up the user's `fullName` via the Tableau Users REST API (`GET /api/<v>/sites/<site-id>/users/<user-id>`), then re-run with `ownerName:eq:<fullName>`, OR",
      '2. Re-run `list-flows` without the `ownerName` filter and read `owner.fullName` from the response to find the correct display-name value, OR',
      "3. If you know the project id for the user's flows, use `projectId:eq:<uuid>` instead.",
      '',
      'The Tableau Flows endpoint does not currently support `ownerEmail`, `ownerDomain`, or `ownerId` filter fields, so `ownerName` is the only owner-based filter available — and it is matched against `fullName`.',
    ].join('\n');
  }

  const projectIdValue = extractProjectIdEqValue(validatedFilter);
  if (projectIdValue && !looksLikeUuid(projectIdValue)) {
    return [
      baseline,
      '',
      `Hint: the \`projectId\` filter you supplied (\`${projectIdValue}\`) is not a UUID. The Tableau Flows REST API requires \`projectId\` to be the project's UUID (8-4-4-4-12 hex form, e.g. \`6f8a2966-e173-11e8-ae74-ffd84c19d7f3\`); any other value silently returns 0 results.`,
      '',
      'To recover:',
      '1. If you have the project name, re-run with `projectName:eq:<name>` instead of `projectId`, OR',
      '2. Look up the project id via the Tableau Projects REST API (`GET /api/<v>/sites/<site-id>/projects?filter=name:eq:<name>`), then re-run with `projectId:eq:<uuid>`, OR',
      '3. Re-run `list-flows` without the project filter and read `project.id` / `project.name` from the response to discover the correct identifiers.',
    ].join('\n');
  }

  return baseline;
}

export const exportedForTesting = {
  listFlowsParamsSchema: paramsSchema,
};
