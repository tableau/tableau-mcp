import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import { Project } from '../../sdks/tableau/types/project.js';
import { Server } from '../../server.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, Tool } from '../tool.js';
import { parseAndValidateProjectsFilterString } from './projectsFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListProjectsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listProjectsTool = new Tool({
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
      filter: "updatedAt:gt:2023-01-01T00:00:00Z"`,
    paramsSchema,
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageSize, limit }, extra): Promise<CallToolResult> => {
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

                const projects = await paginate({
                  pageConfig: {
                    pageSize,
                    limit: maxResultLimit
                      ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                      : limit,
                  },
                  getDataFn: async (pageConfig) => {
                    const { pagination, projects: data } =
                      await restApi.projectsMethods.queryProjects({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        pageSize: pageConfig.pageSize,
                        pageNumber: pageConfig.pageNumber,
                      });

                    return { pagination, data };
                  },
                });

                return projects;
              },
            }),
          );
        },
        constrainSuccessResult: (projects) =>
          constrainProjects({ projects, boundedContext: configWithOverrides.boundedContext }),
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
