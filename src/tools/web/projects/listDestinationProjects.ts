import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  DestinationProjectsApiDisabledError,
  McpToolError,
  PageExceedsLimitError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  DestinationProject,
  destinationProjectContentTypeSchema,
} from '../../../sdks/tableau/types/project.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { getTableauErrorCode } from '../../../utils/getTableauErrorCode.js';
import { getPage, getPageExceedsLimitMessage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { Provider } from '../../../utils/provider.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateProjectsFilterString } from './projectsFilterUtils.js';

// Tableau error code (FEATURE_DISABLED) returned when the site's `GetDestinationProjectsAPI`
// feature flag is off.
const DESTINATION_PROJECTS_API_DISABLED_CODE = '403157';

const MAX_SOURCE_IDS = 100;

const paramsSchema = {
  contentType: destinationProjectContentTypeSchema
    .optional()
    .default('workbook')
    .describe('The kind of content being published or moved (default "workbook").'),
  sourceIds: z
    .array(z.string().nonempty())
    .max(MAX_SOURCE_IDS)
    .optional()
    .describe(
      `When moving existing content, the LUIDs (max ${MAX_SOURCE_IDS}) of the items being moved, so destinations that are invalid for them (e.g. a project's own descendant) are flagged. Omit when publishing new content.`,
    ),
  filter: z.string().optional(),
  pageNumber: z
    .number()
    .int()
    .gt(0)
    .optional()
    .describe('Which 1000-item page to fetch (1-based, default 1).'),
  limit: z
    .number()
    .int()
    .gt(0)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      'The maximum number of projects to return from the requested page (must be <= 1000). Use `limit: 1` when you only need the `totalAvailable` count.',
    ),
};

export const getListDestinationProjectsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const listDestinationProjectsTool = new WebTool({
    server,
    name: 'list-destination-projects',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('destination-projects')),
    ),
    description: `
  Retrieves the projects on a Tableau site that the user can see as candidate destinations for publishing or moving content, each annotated with whether the user can actually put that content there. Call this BEFORE publish-workbook or move-workbook to pick a destination project the user is allowed to use.

  **Destination status**
  Every returned project has a \`status\`:
  - \`VALID\`: the user can publish/move the given \`contentType\` into this project. Only offer these as destinations.
  - \`INSUFFICIENT_PERMISSIONS\`: the user can see the project but lacks permission to publish/move content into it.
  - \`STRUCTURALLY_INVALID\`: the project cannot hold the content for structural reasons (e.g. moving a project into itself or one of its descendants).
  Non-\`VALID\` projects are returned so parent/child structure and counts stay intact; do not suggest them as destinations.

  **Supported Filter Fields and Operators**
  | Field             | Operators            |
  |-------------------|----------------------|
  | createdAt         | eq, gt, gte, lt, lte |
  | name              | eq, in               |
  | ownerDomain       | eq, in               |
  | ownerEmail        | eq, in               |
  | ownerName         | eq, in               |
  | parentProjectId   | eq, in               |
  | topLevelProject   | eq                   |
  | updatedAt         | eq, gt, gte, lt, lte |

  ${genericFilterDescription}

  **Example Usage:**
  - Projects the user could publish a new workbook to:
      contentType: "workbook"
  - Top-level destinations for a new data source:
      contentType: "datasource"
      filter: "topLevelProject:eq:true"
  - Destinations for moving two existing workbooks:
      contentType: "workbook"
      sourceIds: ["abc-123", "def-456"]

  **Pagination**
  This tool returns a single 1000-item page per call. Use \`pageNumber\` to select which 1-based page to fetch (default 1).
  The response is a flat object \`{ data, totalAvailable }\`; to collect every project, keep incrementing \`pageNumber\` until you have gathered \`totalAvailable\` items.

  **Availability**
  This relies on an experimental Tableau REST API. If the site has not enabled it, the call fails with a "destination projects API is not enabled" message — fall back to list-projects.`,
    paramsSchema,
    annotations: {
      title: 'List Destination Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { contentType, sourceIds, filter, pageNumber, limit },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateProjectsFilterString(filter) : undefined;
      const maxResultLimit = configWithOverrides.getMaxResultLimit(
        listDestinationProjectsTool.name,
      );

      return await listDestinationProjectsTool.logAndExecute({
        extra,
        args: { contentType, sourceIds },
        callback: async () => {
          const pageExceedsLimitMessage = getPageExceedsLimitMessage({
            pageNumber,
            maxResultLimit,
          });
          if (pageExceedsLimitMessage) {
            return new PageExceedsLimitError(pageExceedsLimitMessage).toErr();
          }

          try {
            return new Ok(
              await useRestApi({
                ...extra,
                jwtScopes: listDestinationProjectsTool.requiredApiScopes,
                callback: async (restApi) => {
                  return await getPage({
                    pageNumber,
                    limit,
                    maxResultLimit,
                    getDataFn: async ({ pageSize, pageNumber }) => {
                      try {
                        const { pagination, projects: data } =
                          await restApi.destinationProjectsMethods.queryDestinationProjects({
                            siteId: restApi.siteId,
                            contentType,
                            sourceIds,
                            filter: validatedFilter,
                            pageSize,
                            pageNumber,
                          });

                        return { pagination, data };
                      } catch (error) {
                        // Only FEATURE_DISABLED means the API is off; any other 403 is an
                        // authorization failure and must not be reported as a flag problem.
                        if (
                          error instanceof Error &&
                          getHttpStatus(error) === '403' &&
                          getTableauErrorCode(error) === DESTINATION_PROJECTS_API_DISABLED_CODE
                        ) {
                          throw new DestinationProjectsApiDisabledError(
                            'The experimental destination projects API is not enabled on this Tableau site. Ask a site administrator to enable it, or use list-projects instead.',
                          );
                        }
                        throw error;
                      }
                    },
                  });
                },
              }),
            );
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }
        },
        constrainSuccessResult: (page) => {
          const constrained = constrainDestinationProjects({
            projects: page.data,
            boundedContext: configWithOverrides.boundedContext,
          });

          if (constrained.type !== 'success') {
            return constrained;
          }

          return {
            type: 'success',
            result: {
              data: constrained.result,
              totalAvailable: page.totalAvailable,
            },
          };
        },
      });
    },
  });

  return listDestinationProjectsTool;
};

export function constrainDestinationProjects({
  projects,
  boundedContext,
}: {
  projects: Array<DestinationProject>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<DestinationProject>> {
  if (projects.length === 0) {
    return {
      type: 'empty',
      message:
        'No destination projects were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { projectIds } = boundedContext;
  if (projectIds) {
    projects = projects.filter((project) => projectIds.has(project.id));
  }

  if (projects.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed projects that can be queried is limited by the server configuration.',
        'While destination projects were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: projects,
  };
}
