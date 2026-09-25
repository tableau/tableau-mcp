import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { MIN_ADMIN_SITE_ROLE, User } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { MAX_PAGE_SIZE, paginateWithMetadata } from '../../../utils/paginate.js';
import { assertAdmin } from '../adminGate.js';
import { ListFlowsTruncationReason } from '../flows/listFlows/listFlows.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { buildUserFilterPredicate } from './usersFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

/**
 * Default cap on returned users when the caller passes no `limit`. An unbounded
 * `list-users` on a large site (tens of thousands of users) produces a multi-MB
 * payload that overflows the MCP response-size limit; the transport then
 * silently truncates it and a low-effort model may not notice — reporting
 * fabricated site-wide totals off a payload it never fully received
 * (W-23757370). Applying a sane default keeps the response consumable, and the
 * accompanying `truncated`/`summary` signal tells the model the list is partial
 * and how to get more. Kept in lockstep with the `${DEFAULT_RESULT_LIMIT}`
 * references in the tool description above.
 */
const DEFAULT_RESULT_LIMIT = 100;

/**
 * Hard ceiling on how many users a SINGLE call can return, applied even to an
 * explicit caller `limit`. The default-limit summary/description invite the
 * model to "pass a higher limit" to page further; without a ceiling a model
 * could pass e.g. `limit: 100000` and re-trigger the exact multi-MB payload
 * overflow this fix exists to prevent (W-23757370). We reuse {@link MAX_PAGE_SIZE}
 * (1000) — the most a single Tableau page returns — as a sane, already-justified
 * bound. An over-ceiling `limit` is clamped and the truncation is surfaced as
 * `max-limit` (not silently), so the model is told. An admin-configured
 * `MAX_RESULT_LIMIT[S]` still wins when it is tighter than this ceiling.
 */
const MAX_USERS_PER_CALL = MAX_PAGE_SIZE;

export const getListUsersTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listUsersTool = new WebTool({
    server,
    name: 'list-users',
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, full name, and last login time.

  Use this tool when you need to:
  - Audit user site roles and permissions
  - Find or enumerate specific users by email, name, or site role
  - Analyze user activity based on last login times

  For "which licensed users are inactive / can we reclaim licenses" tasks, prefer the purpose-built \`user-license-reclamation-inform\` / \`user-license-reclamation-apply\` prompts (they add reclamation-specific analysis and human-in-the-loop safety) or \`query-admin-insights\` with \`kind=ts-users\` (its \`lastLogin\` is blind to Desktop/Prep activity). Reach for raw \`list-users\` to inspect specific users, not as the primary license-reclamation path.

  **Parameters:**
  - \`filter\` (optional) – Filter string with format \`field:operator:value\`. Multiple filters are comma-separated (AND logic). Same field can appear multiple times for range queries (e.g. \`lastLogin:gt:X,lastLogin:lt:Y\`).
  - \`pageSize\` (optional) – Number of users to fetch from the API per page (default 100, max 1000). Controls server-side pagination.
  - \`limit\` (optional) – Maximum number of MATCHING users to return. \`limit\` bounds results AFTER \`filter\` is applied: the tool keeps paging until it has \`limit\` filter-matches (or the site is exhausted), so \`limit:5\` with an inactivity filter returns the first 5 matching users, never 5 pre-filter rows that all get filtered away. **If omitted, a default limit of ${DEFAULT_RESULT_LIMIT} is applied** — the full user list on a large site can exceed the response-size limit and be silently truncated in transit, so an unbounded call returns a bounded, readable page flagged \`truncated:true\` with \`truncationReason:"default-limit"\`. Add a \`filter\` to target specific users, or pass a higher \`limit\` to page further. A single call returns at most ${MAX_USERS_PER_CALL} users: a larger \`limit\` is clamped to that ceiling and reported as \`truncationReason:"max-limit"\` (page with a \`filter\` for more).

  **Filterable Fields:**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | \`id\` | string | \`eq\`, \`in\` | \`id:eq:abc123\` |
  | \`name\` | string | \`eq\`, \`in\` | \`name:eq:jsmith\` |
  | \`siteRole\` | string | \`eq\`, \`in\` | \`siteRole:eq:Creator\` |
  | \`email\` | string | \`eq\`, \`in\` | \`email:eq:user@example.com\` |
  | \`fullName\` | string | \`eq\`, \`in\` | \`fullName:eq:John Smith\` |
  | \`lastLogin\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`lastLogin:lt:2025-01-01T00:00:00Z\` |

  Never-signed-in users have no \`lastLogin\`: they MATCH \`lt\`/\`lte\` (counted as most-inactive) and are EXCLUDED from \`gt\`/\`gte\`/\`eq\`.

  **Filter Examples:**
  - Single filter: \`siteRole:eq:Creator\`
  - Date range: \`lastLogin:gt:2025-01-01T00:00:00Z,lastLogin:lt:2025-06-01T00:00:00Z\`
  - IN operator: \`siteRole:in:Creator|Explorer\`
  - Inactive users: \`lastLogin:lt:2024-12-01T00:00:00Z\`

  **Response:** A JSON object \`{ users: [...], mcp: { resultInfo: {...} } }\`. Each user in \`users\` includes:
  - \`id\` – user ID
  - \`name\` – username
  - \`siteRole\` – ServerAdministrator, SiteAdministratorCreator, Creator, Explorer, Viewer, Unlicensed, etc.
  - \`email\` – user email address
  - \`fullName\` – user's full display name
  - \`lastLogin\` – timestamp of last login (ISO 8601)

  \`mcp.resultInfo\` is present on every non-empty result and reports completeness of the (filtered) list (a filter matching zero users returns a plain message instead):
  - \`returnedCount\` – number of users in \`users\`.
  - \`truncated\` – \`false\` means \`users\` is the COMPLETE set matching the filter; \`true\` means more matching users exist server-side than were returned.
  - \`truncationReason\` (only when \`truncated\`): \`"requested-limit"\` (your \`limit\` cut it short — call again with a higher \`limit\`), \`"admin-cap"\` (a site per-call cap cut it short — narrow the \`filter\` or ask an admin to raise the cap), \`"default-limit"\` (you passed no \`limit\` so the tool applied a default cap of ${DEFAULT_RESULT_LIMIT} — this is a PARTIAL page, NOT site-wide totals; add a \`filter\` to target users or pass a higher \`limit\`), or \`"max-limit"\` (your \`limit\` exceeded the per-call maximum of ${MAX_USERS_PER_CALL} and was clamped — \`limit\` cannot raise it; narrow the \`filter\` and page).
  - \`summary\` – a plain-language sentence stating whether the list is complete or partial and, if partial, how to get more. Always present. Relay it to the user; never report a \`truncated\` list as complete or as site-wide totals.
  `,
    paramsSchema,
    annotations: {
      title: 'List Users',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await listUsersTool.logAndExecute<ListUsersToolResult>({
        extra,
        args,
        callback: async () => {
          let siteTotalAvailable: number | undefined;

          // Build the filter predicate INSIDE the executed callback so an invalid
          // filter surfaces as a clean `isError` result rather than an uncaught
          // throw. `buildUserFilterPredicate` is the single source of truth shared
          // with `applyUserFilters`.
          const filterPredicate = buildUserFilterPredicate(args.filter);

          const { users, truncated, truncationReason } = await useRestApi({
            ...extra,
            jwtScopes: listUsersTool.requiredApiScopes,
            callback: async (restApi) => {
              // Verify user has admin privileges
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              const maxResultLimit = configWithOverrides.getMaxResultLimit(listUsersTool.name);
              // Two caps bound the result, plus the caller's own request:
              //  - the injected default (when the caller passed no `limit`), so an
              //    unbounded call can't produce an unconsumable payload;
              //  - a hard per-call ceiling (MAX_USERS_PER_CALL) that clamps even an
              //    explicit over-large `limit`, so "pass a higher limit" can't
              //    re-trigger the overflow this fix prevents (W-23757370);
              //  - any admin-configured MAX_RESULT_LIMIT[S], which wins when tighter.
              // `args.limit` stays the record of what the caller actually asked for
              // and drives the honest truncation label below.
              const requestedOrDefaultLimit = args.limit ?? DEFAULT_RESULT_LIMIT;
              const ceiling =
                maxResultLimit !== null
                  ? Math.min(MAX_USERS_PER_CALL, maxResultLimit)
                  : MAX_USERS_PER_CALL;
              const effectiveLimit = Math.min(ceiling, requestedOrDefaultLimit);

              const { items, truncatedByLimit } = await paginateWithMetadata<User>({
                pageConfig: {
                  pageSize: args.pageSize,
                  limit: effectiveLimit,
                },
                // Push the filter INTO the pagination loop so `limit` bounds
                // POST-filter matches, not the raw fetch (the W-23600028 bug: a
                // small `limit` + an inactivity filter returned 0 because the
                // first `limit` fetched rows were active users filtered out after
                // truncation).
                filterFn: filterPredicate,
                getDataFn: async (pageConfig) => {
                  const result = await restApi.usersMethods.listUsers({
                    siteId: restApi.siteId,
                    pageSize: pageConfig.pageSize,
                    pageNumber: pageConfig.pageNumber,
                    includeUserCount: true,
                    includeGroups: false,
                    // Request an explicit, lean field set. Every field must be named
                    // — do NOT rely on Tableau's "default" set: on some sites the
                    // default silently omits lastLogin (the original bug), even though
                    // the REST docs call it a default field. We deliberately avoid
                    // `_all_` because it pulls the expensive SSO/authSetting path we
                    // don't need. See rest_api_concepts_fields.htm.
                    fields: 'id,name,fullName,siteRole,email,lastLogin',
                  });

                  const pagination = result.pagination ?? {
                    pageNumber: pageConfig.pageNumber ?? 1,
                    pageSize: pageConfig.pageSize ?? 100,
                    totalAvailable: result.users.length,
                  };

                  if (siteTotalAvailable === undefined) {
                    siteTotalAvailable = pagination.totalAvailable;
                  }

                  return { pagination, data: result.users };
                },
              });

              // Project to exactly the fields this tool advertises. The `fields`
              // query param is only an "include at least" hint on this endpoint —
              // Tableau still returns authSetting/locale/language/externalAuthUserId,
              // and userSchema declares them as known optional keys so Zod does NOT
              // strip them. This projection is what actually enforces the lean
              // output. Filtering already happened inside the pagination loop
              // (order: fetch → filter (limit-bounded) → project → serialize).
              const projectedUsers = items.map(projectLeanUser);

              const { truncated, truncationReason } = classifyUsersTruncation({
                truncatedByLimit,
                callerLimit: args.limit,
                adminCap: maxResultLimit,
                hardCeiling: MAX_USERS_PER_CALL,
                effectiveLimit,
              });

              return { users: projectedUsers, truncated, truncationReason };
            },
          });

          const summary = buildUsersResultSummary({
            returnedCount: users.length,
            truncated,
            truncationReason,
            totalAvailable: siteTotalAvailable,
            hasFilter: Boolean(args.filter),
          });

          const toolResult: ListUsersToolResult = {
            users,
            totalAvailable: siteTotalAvailable,
            mcp: {
              resultInfo: {
                returnedCount: users.length,
                truncated,
                ...(truncationReason && { truncationReason }),
                summary,
              },
            },
          };
          return new Ok(toolResult);
        },
        constrainSuccessResult: (toolResult) => constrainUsers(toolResult),
      });
    },
  });

  return listUsersTool;
};

/**
 * The exact set of user fields this tool returns. Kept in sync with the `fields`
 * query param and the documented output. Every key is optional except `id`/`name`
 * because Tableau may omit them (e.g. `lastLogin` for never-logged-in users).
 */
type LeanUser = Pick<User, 'id' | 'name' | 'fullName' | 'siteRole' | 'email' | 'lastLogin'>;

/**
 * Project a full Tableau user down to the lean, advertised field set. Optional
 * keys that are absent on the source are omitted entirely (not emitted as null),
 * matching the tool's prior serialization behavior for never-logged-in users.
 */
function projectLeanUser(user: User): LeanUser {
  const lean: LeanUser = { id: user.id, name: user.name };
  if (user.fullName !== undefined) lean.fullName = user.fullName;
  if (user.siteRole !== undefined) lean.siteRole = user.siteRole;
  if (user.email !== undefined) lean.email = user.email;
  if (user.lastLogin !== undefined) lean.lastLogin = user.lastLogin;
  return lean;
}

/**
 * Why a list-users result was cut short. Extends list-flows' shared reasons
 * (`requested-limit`/`admin-cap`) with two reasons list-users needs and
 * list-flows does not:
 *  - `'default-limit'` — the caller passed no `limit`, so the tool applied its
 *    injected default cap (see {@link DEFAULT_RESULT_LIMIT}). A cap the caller
 *    did not ask for and can lift with its own `limit`.
 *  - `'max-limit'` — the caller's explicit `limit` exceeded the hard per-call
 *    ceiling (see {@link MAX_USERS_PER_CALL}) and was clamped to it. `limit`
 *    cannot raise it; narrow the matching set with a `filter` and page instead.
 */
export type ListUsersTruncationReason = ListFlowsTruncationReason | 'default-limit' | 'max-limit';

export type ListUsersResultInfo = {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListUsersTruncationReason;
  /**
   * Always-present plain-language completeness sentence. A deliberate in-DATA
   * signal (not just a boolean plus a description instruction): a low-effort
   * model that only skims the payload still reads, in words, that a truncated
   * list is partial and must not be reported as site-wide totals (W-23757370).
   */
  summary: string;
};

/**
 * Build the `mcp.resultInfo.summary` sentence. See {@link ListUsersResultInfo}
 * for why this lives in the data rather than relying on the tool description.
 */
export function buildUsersResultSummary({
  returnedCount,
  truncated,
  truncationReason,
  totalAvailable,
  hasFilter,
}: {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListUsersTruncationReason;
  totalAvailable?: number;
  hasFilter: boolean;
}): string {
  const noun = hasFilter ? 'matching user' : 'user';
  const plural = returnedCount === 1 ? '' : 's';

  if (!truncated) {
    const verb = returnedCount === 1 ? 'is' : 'are';
    return `Complete list: all ${returnedCount} ${noun}${plural} ${verb} included.`;
  }

  // `totalAvailable` is Tableau's site-wide, PRE-filter count — an honest
  // denominator ONLY when no filter was applied. With a filter it overstates the
  // matches, so omit it rather than invite a misleading "N of M".
  const ofTotal = !hasFilter && totalAvailable !== undefined ? ` of ${totalAvailable}` : '';

  switch (truncationReason) {
    case 'default-limit':
      return (
        `Partial list — showing the first ${returnedCount}${ofTotal} ${noun}${plural}. ` +
        `No limit was provided, so a default cap of ${DEFAULT_RESULT_LIMIT} was applied to keep the response readable. ` +
        'This is NOT the complete list: do not report these as site-wide totals or infer a full role breakdown from them. ' +
        'To find specific users add a filter (e.g. "siteRole:eq:Creator" or an inactivity filter "lastLogin:lt:<ISO date>"); to return more pass a higher "limit". ' +
        'For license-reclamation or inactivity analysis, prefer the user-license-reclamation-inform prompt or query-admin-insights (kind=ts-users).'
      );
    case 'admin-cap':
      return (
        `Partial list — showing the first ${returnedCount} ${noun}${plural}; a site per-call cap limited the result. ` +
        'Narrow the "filter" so the matching set fits, or ask an administrator to raise the cap.'
      );
    case 'max-limit':
      return (
        `Partial list — showing the first ${returnedCount} ${noun}${plural}; your "limit" exceeded the per-call maximum of ${MAX_USERS_PER_CALL} and was clamped to it. ` +
        'A single call cannot return more; narrow the "filter" so the matching set fits, or page through with repeated calls.'
      );
    case 'requested-limit':
    default:
      return (
        `Partial list — showing the first ${returnedCount} ${noun}${plural}; your "limit" cut it short and more match. ` +
        'Call again with a higher "limit" to get more.'
      );
  }
}

/**
 * Classify whether — and why — the page loop returned fewer users than match the
 * request. list-users has its own classifier (rather than reusing list-flows'
 * `buildTruncationInfo`) because it has two extra binding constraints list-flows
 * lacks: an injected default cap and a hard per-call ceiling
 * (see {@link ListUsersTruncationReason}).
 *
 * Precedence when truncated (in order): the admin cap (`MAX_RESULT_LIMIT[S]`)
 * when it is the binding minimum and the caller did not request an equal/smaller
 * `limit`; the injected default when the caller passed no `limit`; the hard
 * ceiling when the caller's explicit `limit` exceeded it; otherwise the caller's
 * own `limit`.
 */
export function classifyUsersTruncation({
  truncatedByLimit,
  callerLimit,
  adminCap,
  hardCeiling,
  effectiveLimit,
}: {
  truncatedByLimit: boolean;
  callerLimit: number | undefined;
  adminCap: number | null;
  hardCeiling: number;
  effectiveLimit: number;
}): { truncated: boolean; truncationReason?: ListUsersTruncationReason } {
  if (!truncatedByLimit) {
    return { truncated: false };
  }

  // The admin cap is the binding constraint when it equals the effective limit
  // actually applied AND the caller did not request an equal-or-smaller `limit`
  // itself. Comparing against `effectiveLimit` (not a recomputed cap) keeps this
  // honest when the injected default is tighter than a looser admin cap — the
  // default, not the cap, bound the result in that case.
  if (
    adminCap !== null &&
    effectiveLimit === adminCap &&
    (callerLimit === undefined || callerLimit > adminCap)
  ) {
    return { truncated: true, truncationReason: 'admin-cap' };
  }

  if (callerLimit === undefined) {
    return { truncated: true, truncationReason: 'default-limit' };
  }

  if (callerLimit > hardCeiling) {
    return { truncated: true, truncationReason: 'max-limit' };
  }

  return { truncated: true, truncationReason: 'requested-limit' };
}

interface ListUsersToolResult {
  users: Array<LeanUser>;
  // Raw server-side site total (pre-filter). Kept top-level as before; because a
  // filter runs client-side this can exceed the matching count, so it is NOT the
  // "matches available" signal — `mcp.resultInfo.truncated` is.
  totalAvailable?: number;
  mcp?: {
    resultInfo: ListUsersResultInfo;
  };
}

export function constrainUsers({
  users,
  totalAvailable,
  mcp,
}: ListUsersToolResult): ConstrainedResult<ListUsersToolResult> {
  if (users.length === 0) {
    return {
      type: 'empty',
      message: 'No users were found. Either none exist or you do not have permission to view them.',
    };
  }

  return { type: 'success', result: { users, totalAvailable, ...(mcp && { mcp }) } };
}
