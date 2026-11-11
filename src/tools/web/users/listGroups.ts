import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Group } from '../../../sdks/tableau/types/group.js';
import { MIN_ADMIN_SITE_ROLE } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { MAX_PAGE_SIZE, paginateWithMetadata } from '../../../utils/paginate.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { classifyUsersTruncation, ListUsersTruncationReason } from './listUsers.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

/**
 * Default cap on returned groups when the caller passes no `limit`. An unbounded call on a large
 * site can overflow the MCP response-size limit; the transport then silently truncates it and a
 * model may report totals from a list it never fully received. Mirrors `list-users`.
 */
const DEFAULT_RESULT_LIMIT = 100;

/**
 * Hard per-call ceiling, applied even to an explicit `limit`, so "pass a higher limit" can't
 * re-trigger the overflow above. An admin-configured MAX_RESULT_LIMITS still wins when tighter.
 */
const MAX_GROUPS_PER_CALL = MAX_PAGE_SIZE;

export const getListGroupsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listGroupsTool = new WebTool({
    server,
    name: 'list-groups',
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves a list of groups on the Tableau site. Each group includes its ID, name, and domain name.

  Use this tool when you need to:
  - Discover which groups exist on the site
  - Look up a group's ID by name
  - Check whether a group already exists before referring to it

  **Parameters:**
  - \`filter\` (optional) – A Tableau REST API filter expression with format \`field:operator:value\` (for example \`name:eq:Sales\`). The filter is applied by Tableau, not by this tool. Multiple expressions are comma-separated.
  - \`pageSize\` (optional) – Number of groups to fetch from the API per page (default 100, max 1000).
  - \`limit\` (optional) – Maximum number of groups to return. **If omitted, a default limit of ${DEFAULT_RESULT_LIMIT} is applied** so an unbounded call on a large site returns a bounded page flagged \`truncated:true\` with \`truncationReason:"default-limit"\`. A single call returns at most ${MAX_GROUPS_PER_CALL} groups: a larger \`limit\` is clamped to that ceiling and reported as \`truncationReason:"max-limit"\`. Use \`filter\` to target specific groups.

  **Response:** A JSON object \`{ groups: [...], totalAvailable: number, truncated: boolean, truncationReason?: string }\`. Each group in \`groups\` includes:
  - \`id\` – group ID
  - \`name\` – group name
  - \`domain.name\` – domain of the group (\`local\` for local groups)

  \`totalAvailable\` is the number of groups Tableau reports for the request. \`truncated\` is \`true\` when a limit cut the list short, so \`groups\` is only a partial list. \`truncationReason\` (only when truncated) is \`"requested-limit"\` (your \`limit\`), \`"admin-cap"\` (a configured MAX_RESULT_LIMITS cap), \`"default-limit"\` (no \`limit\` was passed, so the default of ${DEFAULT_RESULT_LIMIT} applied) or \`"max-limit"\` (your \`limit\` exceeded ${MAX_GROUPS_PER_CALL} and was clamped). Do not report a truncated list as complete or as site-wide totals; narrow with \`filter\` to reach specific groups.
  `,
    paramsSchema,
    annotations: {
      title: 'List Groups',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await listGroupsTool.logAndExecute<ListGroupsToolResult>({
        extra,
        args,
        callback: async () => {
          const result = await useRestApi({
            ...extra,
            jwtScopes: listGroupsTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              // The caller's limit (or the default), clamped by the hard per-call ceiling and any
              // admin-configured MAX_RESULT_LIMITS, whichever is tighter.
              const maxResultLimit = configWithOverrides.getMaxResultLimit(listGroupsTool.name);
              const ceiling =
                maxResultLimit !== null
                  ? Math.min(MAX_GROUPS_PER_CALL, maxResultLimit)
                  : MAX_GROUPS_PER_CALL;
              const effectiveLimit = Math.min(ceiling, args.limit ?? DEFAULT_RESULT_LIMIT);

              const { items, totalAvailable, truncatedByLimit } = await paginateWithMetadata<Group>(
                {
                  pageConfig: { pageSize: args.pageSize, limit: effectiveLimit },
                  getDataFn: async (pageConfig) => {
                    const { groups, pagination } = await restApi.usersMethods.listGroups({
                      siteId: restApi.siteId,
                      pageSize: pageConfig.pageSize,
                      pageNumber: pageConfig.pageNumber,
                      filter: args.filter,
                    });

                    return {
                      pagination: pagination ?? {
                        pageNumber: pageConfig.pageNumber ?? 1,
                        pageSize: pageConfig.pageSize ?? 100,
                        totalAvailable: groups.length,
                      },
                      data: groups,
                    };
                  },
                },
              );

              const { truncated, truncationReason } = classifyUsersTruncation({
                truncatedByLimit,
                callerLimit: args.limit,
                adminCap: maxResultLimit,
                hardCeiling: MAX_GROUPS_PER_CALL,
                effectiveLimit,
              });

              return {
                groups: items,
                totalAvailable,
                truncated,
                ...(truncationReason && { truncationReason }),
              };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (toolResult) => constrainGroups(toolResult),
      });
    },
  });

  return listGroupsTool;
};

interface ListGroupsToolResult {
  groups: Array<Group>;
  totalAvailable: number;
  truncated: boolean;
  truncationReason?: ListUsersTruncationReason;
}

export function constrainGroups(
  result: ListGroupsToolResult,
): ConstrainedResult<ListGroupsToolResult> {
  if (result.groups.length === 0) {
    return {
      type: 'empty',
      message:
        'No groups were found. Either none exist or you do not have permission to view them.',
    };
  }

  return { type: 'success', result };
}
