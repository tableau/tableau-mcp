import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Project } from '../../../sdks/tableau/types/project.js';
import { WebMcpServer } from '../../../server.web.js';
import { getPage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateProjectsFilterString } from './projectsFilterUtils.js';

const paramsSchema = {
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
      'The maximum number of projects to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants.',
    ),
};

export const getListProjectsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listProjectsTool = new WebTool({
    server,
    name: 'list-projects',
    description: `
  Retrieves a list of projects on a Tableau site including their metadata such as name, description, parent project, content permissions, owner, and timestamps. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Default) for precise project discovery. Use this tool when a user requests to list, search, or filter Tableau projects on a site.

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
  - List all projects on a site
  - List projects with the name "Default":
      filter: "name:eq:Default"
  - List top-level projects only:
      filter: "topLevelProject:eq:true"
  - List child projects of a specific parent:
      filter: "parentProjectId:eq:abc-123"
  - List projects updated after January 1, 2023:
      filter: "updatedAt:gt:2023-01-01T00:00:00Z"

  **Pagination**
  This tool returns a single 1000-item page per call. Use \`pageNumber\` to select which 1-based page to fetch (default 1). The response is a flat object \`{ data, totalAvailable }\`; to collect every project, keep incrementing \`pageNumber\` until you have gathered \`totalAvailable\` items.`,
    paramsSchema,
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageNumber, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateProjectsFilterString(filter) : undefined;

      return await listProjectsTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listProjectsTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(listProjectsTool.name);

                return await getPage({
                  pageNumber,
                  limit,
                  maxResultLimit,
                  getDataFn: async ({ pageSize, pageNumber }) => {
                    const { pagination, projects: data } =
                      await restApi.projectsMethods.queryProjects({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        pageSize,
                        pageNumber,
                      });

                    return { pagination, data };
                  },
                });
              },
            }),
          );
        },
        constrainSuccessResult: (page) => {
          const constrained = constrainProjects({
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

  return listProjectsTool;
};

export function constrainProjects({
  projects,
  boundedContext,
}: {
  projects: Array<Project>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<Project>> {
  if (projects.length === 0) {
    return {
      type: 'empty',
      message:
        'No projects were found. Either none exist or you do not have permission to view them.',
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
        'While projects were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: projects,
  };
}
