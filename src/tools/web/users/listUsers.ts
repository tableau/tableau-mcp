import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { User } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { paginate } from '../../../utils/paginate.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { applyUserFilters } from './usersFilterUtils.js';

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
  - \`limit\` (optional) – Maximum total results to return after filtering.

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

  **Response:** Each user includes:
  - \`id\` – user ID
  - \`name\` – username
  - \`siteRole\` – ServerAdministrator, SiteAdministratorCreator, Creator, Explorer, Viewer, Unlicensed, etc.
  - \`email\` – user email address
  - \`fullName\` – user's full display name
  - \`lastLogin\` – timestamp of last login (ISO 8601)
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

      return await listUsersTool.logAndExecute({
        extra,
        args,
        callback: async () => {
          let siteTotalAvailable: number | undefined;

          const users = await useRestApi({
            ...extra,
            jwtScopes: listUsersTool.requiredApiScopes,
            callback: async (restApi) => {
              // Verify user has admin privileges
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              const maxResultLimit = configWithOverrides.getMaxResultLimit(listUsersTool.name);

              return paginate({
                pageConfig: {
                  pageSize: args.pageSize,
                  limit: maxResultLimit
                    ? Math.min(maxResultLimit, args.limit ?? Number.MAX_SAFE_INTEGER)
                    : args.limit,
                },
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
            },
          });

          // Apply client-side filtering (may reference any of the fetched fields).
          const filteredUsers = applyUserFilters(users, args.filter);

          // Project to exactly the fields this tool advertises. The `fields` query
          // param is only an "include at least" hint on this endpoint — Tableau
          // still returns authSetting/locale/language/externalAuthUserId, and
          // userSchema declares them as known optional keys so Zod does NOT strip
          // them. This projection is what actually enforces the lean output. Runs
          // AFTER filtering (order: fetch → filter → project → serialize).
          const projectedUsers = filteredUsers.map(projectLeanUser);

          const toolResult: ListUsersToolResult = {
            users: projectedUsers,
            totalAvailable: siteTotalAvailable,
          };
          return new Ok(toolResult);
        },
        constrainSuccessResult: (toolResult) =>
          constrainUsers({ users: toolResult.users, totalAvailable: toolResult.totalAvailable }),
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

interface ListUsersToolResult {
  users: Array<LeanUser>;
  totalAvailable?: number;
}

export function constrainUsers({
  users,
  totalAvailable,
}: {
  users: Array<LeanUser>;
  totalAvailable?: number;
}): ConstrainedResult<ListUsersToolResult> {
  if (users.length === 0) {
    return {
      type: 'empty',
      message: 'No users were found. Either none exist or you do not have permission to view them.',
    };
  }

  return { type: 'success', result: { users, totalAvailable } };
}
