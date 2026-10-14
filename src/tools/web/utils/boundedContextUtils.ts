import { ProjectNotAllowedError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';

export function assertProjectAllowedByBoundedContext(
  projectId: string,
  boundedContext: BoundedContext,
): void {
  const { projectIds } = boundedContext;
  if (projectIds && !projectIds.has(projectId)) {
    throw new ProjectNotAllowedError(
      `Targeting project with LUID ${projectId} is not allowed by this MCP server's bounded project context.`,
    );
  }
}
