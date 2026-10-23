import { ProjectNotAllowedError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { splitTopLevel } from '../../../utils/parseAndValidateFilterString.js';

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

/**
 * Narrow a list-* tool's server-side `filter` to the tags allowed by `INCLUDE_TAGS`.
 *
 * When a tag allow-list is configured, the matching items can be filtered by the
 * Tableau REST API itself (`tags:eq`/`tags:in`) instead of fetching everything and
 * discarding the rest client-side. The client-side `constrain*` pass still runs as
 * defense-in-depth.
 *
 * Returns the filter string to send to the API:
 *  - no allowed tags -> the filter unchanged (empty string when there is none);
 *  - the caller already filtered on `tags` -> unchanged, so a user's explicit tag
 *    filter is never widened or duplicated (the bounded context is still enforced
 *    client-side);
 *  - otherwise -> the allowed tags appended as one `tags:eq:<tag>` (single) or
 *    `tags:in:[<tag>,...]` (multiple) expression, OR-matching to mirror the
 *    client-side `.some(...)` check.
 */
export function appendBoundedContextTagsFilter(
  validatedFilter: string | undefined,
  tags: Set<string> | null,
): string {
  const baseFilter = validatedFilter ?? '';
  if (!tags || tags.size === 0) {
    return baseFilter;
  }

  const hasTagsClause = splitTopLevel(baseFilter, ',').some(
    (clause) => clause.trim().split(':')[0] === 'tags',
  );
  if (hasTagsClause) {
    return baseFilter;
  }

  const allowedTags = [...tags];
  const tagsClause =
    allowedTags.length === 1 ? `tags:eq:${allowedTags[0]}` : `tags:in:[${allowedTags.join(',')}]`;

  return baseFilter ? `${baseFilter},${tagsClause}` : tagsClause;
}
