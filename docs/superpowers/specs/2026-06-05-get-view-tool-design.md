# Get View Tool Design

## Overview

Add a `get-view` MCP tool that retrieves detailed metadata for a single Tableau view by its ID. This fills a gap in the current tool suite where users can list views or get view data/images, but cannot directly fetch a single view's metadata when they already have a view ID.

## Motivation

**Current State:**
- `list-views` - Lists all views with optional filtering (can be inefficient if you already have an ID)
- `get-view-data` - Gets CSV data from a view
- `get-view-image` - Gets an image of a view
- No direct way to get view metadata by ID

**Use Cases:**
1. User has a view ID from another tool/source and wants its metadata
2. Following up from a workbook query (workbook contains view IDs) to get view details
3. Debugging/troubleshooting specific views by ID
4. Building workflows that pass view IDs between steps

**Existing Pattern:**
Both `get-workbook` and `get-datasource-metadata` tools already exist and use `resourceAccessChecker` for access control. The `get-view` tool follows the same established pattern for consistency.

## Design

### Tool Specification

**Name:** `get-view`

**Description:** Retrieves detailed metadata for a single Tableau view by its ID, including upstream datasources, workbook information, project details, owner, tags, and usage statistics.

**Parameters:**
```typescript
{
  viewId: string  // Required - The LUID of the view to retrieve
}
```

**Response:**
```typescript
{
  id: string
  name: string
  contentUrl: string
  workbook: { id: string, name: string }
  project: { id: string, name: string }
  owner: { id: string, name: string }
  tags: Array<{ label: string }>
  createdAt: string (ISO 8601)
  updatedAt: string (ISO 8601)
  totalViewCount: number
  upstreamDatasources: Array<{ luid: string, name: string }>  // If lineage enabled
}
```

### Implementation Approach

The tool follows the exact pattern established by `get-workbook` and reuses existing infrastructure:

#### 1. Access Control
Before fetching the view, check access permissions:
```typescript
const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
  viewId,
  extra,
});

if (!isViewAllowedResult.allowed) {
  return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
}
```

This respects bounded context configuration:
- `projectIds` - Only views in allowed projects
- `workbookIds` - Only views in allowed workbooks
- `viewIds` - Explicit view ID allowlist
- `tags` - Only views with allowed tags

#### 2. Fetch View Metadata
Call the existing REST API method:
```typescript
const view = await restApi.viewsMethods.getView({
  viewId,
  siteId: restApi.siteId,
});
```

This returns basic view metadata including built-in usage statistics.

#### 3. Enrich with Lineage (Conditional)
If metadata API requests are enabled (default):
```typescript
if (!configWithOverrides.disableMetadataApiRequests) {
  try {
    const response = await restApi.metadataMethods.graphql(
      getViewLineageQuery([view.id])
    );
    
    view = mergeViewLineage(
      [view],
      getViewLineageByLuid(response),
      configWithOverrides.boundedContext.datasourceIds
    )[0];
  } catch (error) {
    log({
      message: `Failed to enrich view ${view.id} with lineage metadata`,
      level: 'warning',
      logger: 'lineage',
      data: getExceptionMessage(error),
    });
    // Continue with unenriched view
  }
}
```

Lineage enrichment adds:
- `upstreamDatasources` - Array of datasources the view queries
- Enhanced `workbook`, `owner`, `project` information
- Filtered by `boundedContext.datasourceIds` if configured

#### 4. Transform Response
Flatten usage statistics for consistency with `list-views`:
```typescript
function flattenViewUsage(view: View): View {
  const { usage, ...rest } = view;
  return {
    ...rest,
    totalViewCount: usage?.totalViewCount ?? 0,
  };
}
```

### Reused Infrastructure

**Existing Components (No Changes Required):**
- `ViewNotAllowedError` class - Already defined in `src/errors/mcpToolError.ts`
- `resourceAccessChecker.isViewAllowed()` - Already implemented
- `restApi.viewsMethods.getView()` - Already implemented
- `getViewLineageQuery()` - Already implemented (used by `list-views`)
- `getViewLineageByLuid()` - Already implemented
- `mergeViewLineage()` - Already implemented

**New Files:**
- `src/tools/web/views/getView.ts` - Tool implementation
- `src/tools/web/views/getView.test.ts` - Unit tests

**Modified Files:**
- `src/tools/web/tools.ts` - Add `getGetViewTool` to factory exports
- `src/tools/web/toolName.ts` - Add `'get-view'` to ToolName type

### Error Handling

**Access Denied:**
Returns `ViewNotAllowedError` with a clear message explaining which bounded context restriction was violated:
- "Querying the view with LUID {id} is not allowed"
- "The view ... does not belong to an allowed workbook"
- "The view ... does not belong to an allowed project"  
- "The view ... does not have one of the allowed tags"

**View Not Found:**
REST API returns 404, tool propagates as standard error

**Metadata API Failure:**
Logs warning and returns view without lineage enrichment (graceful degradation)

### Required Scopes

- `tableau:content:read` - For REST API `getView` call
- Metadata API scopes - Inherited from `WebTool` base class for lineage queries

### Testing Strategy

**Unit Tests (`getView.test.ts`):**
1. Successfully fetch view metadata
2. Access denied by viewIds allowlist
3. Access denied by projectIds allowlist
4. Access denied by workbookIds allowlist
5. Access denied by tags allowlist
6. Lineage enrichment succeeds
7. Lineage enrichment fails gracefully
8. Metadata API disabled - no lineage call
9. Usage stats flattening
10. Bounded context filters upstream datasources

**Test Doubles:**
- Mock `resourceAccessChecker` responses
- Mock `restApi.viewsMethods.getView()`
- Mock `restApi.metadataMethods.graphql()`
- Use existing mock utilities from `mockView.ts`

## Alternatives Considered

### Alternative 1: Minimal (No Enrichment)
Just return the basic REST API response without lineage.

**Rejected:** Inconsistent with `get-workbook` and `list-views` which both enrich with lineage. Users would get different data depending on which tool they use.

### Alternative 2: Parameterized Enrichment
Add `includeLineage` boolean parameter to control enrichment.

**Rejected:** Adds complexity without clear benefit. The enrichment is fast, fails gracefully, and can be disabled globally via `disableMetadataApiRequests` config if needed.

### Alternative 3: Re-fetch Usage Stats
Like `get-workbook` does for its views, call `queryViewsForWorkbook` to ensure usage stats are present.

**Rejected:** The `getView` REST API already returns usage statistics, so this would be redundant. Unlike workbook.views which may lack usage stats, a direct view fetch includes them.

## Implementation Notes

**Consistency with get-workbook:**
The implementation mirrors `get-workbook` structure:
1. Access check first
2. Fetch resource
3. Conditional enrichment with Metadata API
4. Graceful error handling
5. Same logging patterns
6. Same MCP tool annotations (readOnlyHint: true, openWorldHint: false)

**Consistency with list-views:**
- Uses identical lineage enrichment logic
- Same response flattening for usage stats
- Same bounded context datasource filtering

**Performance:**
- Single view: ~2 API calls (REST + Metadata)
- List-views with 1 result: ~2 API calls (REST + Metadata)
- Get-view is equally efficient when you already have the ID

## Future Enhancements

Not in scope for this design, but potential future additions:
- Batch get-views by multiple IDs (reduce Metadata API calls)
- Include view preview thumbnail URL
- Support for custom view metadata via view ID
- Cache frequently accessed view metadata

## Summary

The `get-view` tool:
- Fills a gap in the current tool suite (direct metadata lookup by ID)
- Follows established patterns from `get-workbook` and `list-views`
- Reuses all existing infrastructure (no new utilities needed)
- Respects bounded context and access control
- Enriches with lineage data for a complete view picture
- Fails gracefully when enrichment is unavailable
- Provides consistent response format across view-related tools
