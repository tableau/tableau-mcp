---
sidebar_position: 7
---

# tableau-operations

Higher-level administrative operations for Tableau Cloud including job conflict detection, permissions analysis, and workbook archiving.

## Operations

### Job Management

- `get-background-job-conflicts` - Detect overlapping background jobs that may be competing for resources
- `get-job-performance-stats` - Get performance statistics for running jobs
- `kill-job-by-priority` - Cancel jobs based on priority with dry-run support

### Permissions & Access

- `get-effective-permissions` - Calculate effective read permissions for a specific user and workbook (heuristic analysis)
- `trace-access-reason` - Trace why a user has access to specific content
- `list-content-overrides` - List content with explicit permission overrides at the project level

### Content Management

- `get-stale-content-report` - Identify workbooks that haven't been accessed in a specified number of days
- `get-workbook-lineage-impact` - Analyze workbook lineage and impact using Tableau Metadata GraphQL API
- `archive-workbook` - Archive a workbook to S3 (if configured) or return as base64

## Parameters

- `operation` (required) - The operation to perform
- `workbookId` - Workbook LUID
- `userId` - User LUID  
- `projectFilter` - Filter for workbooks by project
- `staleDays` - Days of inactivity threshold (default from `TABLEAU_OPS_STALE_DAYS`)
- `runningThresholdMinutes` - Job runtime threshold (default from `TABLEAU_OPS_RUNNING_THRESHOLD_MINUTES`)
- `minPriority` - Minimum priority for job cancellation
- `overlapWindowMs` - Time window for detecting job overlaps (default from `TABLEAU_OPS_OVERLAP_WINDOW_MS`)
- `dryRun` - Preview actions without executing (for kill-job-by-priority)
- `maxCancels` - Maximum number of jobs to cancel
- `maxBase64Bytes` - Maximum size for base64 encoding

## Environment Variables

### S3 Archive Configuration

- `TABLEAU_ARCHIVE_S3_BUCKET` - S3 bucket name for workbook archiving
- `TABLEAU_ARCHIVE_S3_REGION` - AWS region
- `TABLEAU_ARCHIVE_S3_KEY_PREFIX` - S3 key prefix

### Operation Defaults

- `TABLEAU_OPS_RUNNING_THRESHOLD_MINUTES` - Default threshold for flagging long-running jobs
- `TABLEAU_OPS_STALE_DAYS` - Default days of inactivity for stale content  
- `TABLEAU_OPS_OVERLAP_WINDOW_MS` - Default time window for detecting job conflicts

## Required Scopes

- **MCP Scope**: `tableau:mcp:admin:operations`
- **API Scopes** (operation-dependent):
  - `tableau:jobs:read`, `tableau:jobs:update` - Job operations
  - `tableau:permissions:read`, `tableau:users:read`, `tableau:groups:read` - Permission analysis
  - `tableau:content:read` - Content operations
  - `tableau:views:download` - Workbook archiving

## Example Usage

```typescript
// Detect job conflicts
{
  operation: "get-background-job-conflicts",
  overlapWindowMs: 60000
}

// Get effective permissions
{
  operation: "get-effective-permissions",
  userId: "user-luid",
  workbookId: "workbook-luid"
}

// Archive workbook to S3
{
  operation: "archive-workbook",
  workbookId: "workbook-luid"
}
```

## Notes

- `get-effective-permissions` provides a heuristic analysis for a single user/workbook pair, not a comprehensive site-wide viewer list
- For complete ACL information, use the `content-permissions` tool with `list-granular-permissions`
- Workbook archiving requires S3 environment variables to be configured; otherwise returns base64 for small workbooks
