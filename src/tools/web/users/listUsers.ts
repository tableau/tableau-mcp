import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { User } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
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
  Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, last login time, and authentication settings.

  Use this tool when you need to:
  - Identify inactive users for license reclamation
  - Audit user site roles and permissions
  - Find users by email, name, or site role
  - Review user authentication settings
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
  | \`authSetting\` | string | \`eq\`, \`in\` | \`authSetting:eq:SAML\` |
  | \`locale\` | string | \`eq\`, \`in\` | \`locale:eq:en_US\` |
  | \`language\` | string | \`eq\`, \`in\` | \`language:eq:en\` |
  | \`externalAuthUserId\` | string | \`eq\`, \`in\` | \`externalAuthUserId:eq:ext-123\` |

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
  - \`authSetting\` – ServerDefault, SAML, or OpenID
  - \`locale\` – user's locale setting
  - \`language\` – user's language preference
  - \`externalAuthUserId\` – ID from external authentication provider
  `,
    paramsSchema,
    annotations: {
      title: 'List Users',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await listUsersTool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const result = await useRestApi({
            ...extra,
            jwtScopes: listUsersTool.requiredApiScopes,
            callback: async (restApi) => {
              // Verify user has admin privileges
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              return restApi.usersMethods.listUsers({
                siteId: restApi.siteId,
                pageSize: args.pageSize,
              });
            },
          });

          // Apply client-side filtering
          let filteredUsers = applyUserFilters(result.users, args.filter);

          // Apply limit to cap total results returned
          if (args.limit) {
            filteredUsers = filteredUsers.slice(0, args.limit);
          }

          const toolResult: ListUsersToolResult = {
            users: filteredUsers,
            totalAvailable: result.pagination?.totalAvailable,
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

interface ListUsersToolResult {
  users: Array<User>;
  totalAvailable?: number;
}

export function constrainUsers({
  users,
  totalAvailable,
}: {
  users: Array<User>;
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
