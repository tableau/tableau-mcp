import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { MIN_ADMIN_SITE_ROLE, User } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { paginateWithMetadata } from '../../../utils/paginate.js';
import { assertAdmin } from '../adminGate.js';
import { buildTruncationInfo, ListFlowsTruncationReason } from '../flows/listFlows/listFlows.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { buildUserFilterPredicate } from './usersFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

export const getListUsersTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listUsersTool = new WebTool({
    server,
    name: 'list-users',
    disabled: !config.adminToolsEnabled,
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    description: `
  Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, full name, and last login time.

  Use this tool when you need to:
  - Identify inactive users for license reclamation
  - Audit user site roles and permissions
  - Find users by email, name, or site role
  - Analyze user activity based on last login times

  **Parameters:**
  - \`filter\` (optional) – Filter string with format \`field:operator:value\`. Multiple filters are comma-separated (AND logic). Same field can appear multiple times for range queries (e.g. \`lastLogin:gt:X,lastLogin:lt:Y\`).
  - \`pageSize\` (optional) – Number of users to fetch from the API per page (default 100, max 1000). Controls server-side pagination.
  - \`limit\` (optional) – Maximum number of MATCHING users to return. \`limit\` bounds results AFTER \`filter\` is applied: the tool keeps paging until it has \`limit\` filter-matches (or the site is exhausted), so \`limit:5\` with an inactivity filter returns the first 5 matching users, never 5 pre-filter rows that all get filtered away.

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
  - \`truncationReason\` (only when \`truncated\`): \`"requested-limit"\` (your \`limit\` cut it short — call again with a higher \`limit\`) or \`"admin-cap"\` (a site per-call cap cut it short — narrow the \`filter\` or ask an admin to raise the cap).
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
              const effectiveLimit = maxResultLimit
                ? Math.min(maxResultLimit, args.limit ?? Number.MAX_SAFE_INTEGER)
                : args.limit;

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

              // Reuse list-flows' truncation classifier so the "requested-limit"
              // vs "admin-cap" reasoning stays a single source of truth.
              const { truncated, truncationReason } = buildTruncationInfo({
                truncatedByLimit,
                maxResultLimit,
                llmLimit: args.limit,
                effectiveLimit,
              });

              return { users: projectedUsers, truncated, truncationReason };
            },
          });

          const toolResult: ListUsersToolResult = {
            users,
            totalAvailable: siteTotalAvailable,
            mcp: {
              resultInfo: {
                returnedCount: users.length,
                truncated,
                ...(truncationReason && { truncationReason }),
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
 * Completeness status attached to every successful list-users response. Mirrors
 * list-flows' `ListFlowsResultInfo` (adapted for users): `truncated:false` means
 * `users` is the COMPLETE set matching the filter; `truncated:true` means more
 * matching users exist server-side than were returned (a limit-truncated
 * FILTERED list is reported as "more matches exist", not silently complete).
 */
export type ListUsersResultInfo = {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListFlowsTruncationReason;
};

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
