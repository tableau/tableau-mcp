# Get View Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `get-view` MCP tool that retrieves detailed metadata for a single Tableau view by ID with access control and lineage enrichment.

**Architecture:** Follow the established pattern from `get-workbook`: access check via `resourceAccessChecker`, fetch via REST API, enrich with Metadata API lineage, flatten usage stats. Reuse all existing infrastructure.

**Tech Stack:** TypeScript, Vitest, Zod, MCP SDK, Tableau REST API, Tableau Metadata API

---

## File Structure

**New Files:**
- `src/tools/web/views/getView.ts` - Main tool implementation with access control, API calls, and lineage enrichment
- `src/tools/web/views/getView.test.ts` - Comprehensive unit tests covering all access control scenarios

**Modified Files:**
- `src/tools/web/toolName.ts` - Add `'get-view'` to tool name constants and view group
- `src/tools/web/tools.ts` - Import and register the tool factory

---

## Task 1: Add Tool Name Constant

**Files:**
- Modify: `src/tools/web/toolName.ts:12` (after `'get-workbook'`)
- Modify: `src/tools/web/toolName.ts:51` (in view group array)

- [ ] **Step 1: Add 'get-view' to webToolNames array**

Open `src/tools/web/toolName.ts` and add the new tool name in alphabetical position within the view-related tools:

```typescript
export const webToolNames = [
  'list-datasources',
  'list-extract-refresh-tasks',
  'list-users',
  'list-workbooks',
  'list-projects',
  'list-views',
  'list-custom-views',
  'query-datasource',
  'get-datasource-metadata',
  'get-workbook',
  'get-view',  // ADD THIS LINE
  'get-view-data',
  'get-view-image',
  'get-custom-view-data',
  'get-custom-view-image',
  // ... rest of array
] as const;
```

- [ ] **Step 2: Add 'get-view' to view tool group**

In the same file, add to the `webToolGroups` object:

```typescript
view: [
  'list-views',
  'list-custom-views',
  'get-view',  // ADD THIS LINE
  'get-view-data',
  'get-view-image',
  'get-custom-view-data',
  'get-custom-view-image',
],
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build:dev`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Commit tool name registration**

```bash
git add src/tools/web/toolName.ts
git commit -m "feat: register get-view tool name"
```

---

## Task 2: Write Failing Tests for Basic Tool Structure

**Files:**
- Create: `src/tools/web/views/getView.test.ts`

- [ ] **Step 1: Write test file boilerplate and first failing test**

Create `src/tools/web/views/getView.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { Ok } from 'ts-results-es';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { getViewLineageByLuid, getViewLineageQuery, mergeViewLineage } from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { exportedForTesting, resourceAccessChecker } from '../resourceAccessChecker.js';
import { getGetViewTool } from './getView.js';
import { mockView } from './mockView.js';

vi.mock('../../../restApiInstance.js');
vi.mock('../resourceAccessChecker.js');

const mockUseRestApi = vi.mocked(useRestApi);
const mockResourceAccessChecker = vi.mocked(resourceAccessChecker);

describe('getView', () => {
  const mockServer = {} as WebMcpServer;
  const mockExtra = {
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      disableMetadataApiRequests: false,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  };

  test('successfully fetches view metadata without enrichment when Metadata API is disabled', async () => {
    const tool = getGetViewTool(mockServer);
    
    mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: true,
    });

    const viewWithUsage: View = {
      ...mockView,
      usage: {
        totalViewCount: 42,
      },
    };

    mockUseRestApi.mockImplementation(async ({ callback }) => {
      const restApi = {
        viewsMethods: {
          getView: vi.fn().mockResolvedValue(viewWithUsage),
        },
        siteId: 'site-123',
      };
      return await callback(restApi as any);
    });

    const extraWithDisabledMetadata = {
      ...mockExtra,
      getConfigWithOverrides: vi.fn().mockResolvedValue({
        disableMetadataApiRequests: true,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      }),
    };

    const result = await tool.callback(
      { viewId: mockView.id },
      extraWithDisabledMetadata as any
    );

    expect(result.isError).toBe(false);
    if (!result.isError) {
      const content = JSON.parse(result.content[0].text);
      expect(content.id).toBe(mockView.id);
      expect(content.name).toBe(mockView.name);
      expect(content.totalViewCount).toBe(42);
      expect(content.usage).toBeUndefined();
      expect(content.upstreamDatasources).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/web/views/getView.test.ts`
Expected: FAIL - "Cannot find module './getView.js'"

- [ ] **Step 3: Commit failing test**

```bash
git add src/tools/web/views/getView.test.ts
git commit -m "test: add failing test for get-view basic structure"
```

---

## Task 3: Implement Basic Tool Structure

**Files:**
- Create: `src/tools/web/views/getView.ts`

- [ ] **Step 1: Write minimal tool implementation**

Create `src/tools/web/views/getView.ts`:

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getViewLineageByLuid,
  getViewLineageQuery,
  mergeViewLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
};

export const getGetViewTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewTool = new WebTool({
    server,
    name: 'get-view',
    description:
      'Retrieves detailed metadata for a single Tableau view by its ID, including upstream datasources, workbook information, project details, owner, tags, and usage statistics.',
    paramsSchema,
    annotations: {
      title: 'Get View',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getViewTool.logAndExecute<View>({
        extra,
        args: { viewId },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getViewTool.requiredApiScopes,
              callback: async (restApi) => {
                let view = await restApi.viewsMethods.getView({
                  viewId,
                  siteId: restApi.siteId,
                });

                if (configWithOverrides.disableMetadataApiRequests) {
                  return flattenViewUsage(view);
                }

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
                }

                return flattenViewUsage(view);
              },
            })
          );
        },
      });
    },
  });

  return getViewTool;
};

function flattenViewUsage(view: View): View {
  const { usage, ...rest } = view;
  return {
    ...rest,
    totalViewCount: usage?.totalViewCount ?? 0,
  };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/tools/web/views/getView.test.ts`
Expected: PASS - "successfully fetches view metadata without enrichment when Metadata API is disabled"

- [ ] **Step 3: Commit basic implementation**

```bash
git add src/tools/web/views/getView.ts
git commit -m "feat: implement get-view tool with access control and lineage enrichment"
```

---

## Task 4: Add Tests for Access Control Scenarios

**Files:**
- Modify: `src/tools/web/views/getView.test.ts`

- [ ] **Step 1: Write test for viewIds allowlist denial**

Add to `src/tools/web/views/getView.test.ts`:

```typescript
test('returns error when view is not in viewIds allowlist', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: false,
    message: 'Querying the view with LUID test-view-id is not allowed.',
  });

  const result = await tool.callback(
    { viewId: 'test-view-id' },
    mockExtra as any
  );

  expect(result.isError).toBe(true);
  if (result.isError) {
    expect(result.content[0].text).toContain('Querying the view with LUID test-view-id is not allowed');
  }
});
```

- [ ] **Step 2: Write test for workbookIds allowlist denial**

Add to the same file:

```typescript
test('returns error when view workbook is not in workbookIds allowlist', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: false,
    message: 'The view with LUID test-view-id cannot be queried because it does not belong to an allowed workbook.',
  });

  const result = await tool.callback(
    { viewId: 'test-view-id' },
    mockExtra as any
  );

  expect(result.isError).toBe(true);
  if (result.isError) {
    expect(result.content[0].text).toContain('does not belong to an allowed workbook');
  }
});
```

- [ ] **Step 3: Write test for projectIds allowlist denial**

Add to the same file:

```typescript
test('returns error when view project is not in projectIds allowlist', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: false,
    message: 'The view with LUID test-view-id cannot be queried because it does not belong to an allowed project.',
  });

  const result = await tool.callback(
    { viewId: 'test-view-id' },
    mockExtra as any
  );

  expect(result.isError).toBe(true);
  if (result.isError) {
    expect(result.content[0].text).toContain('does not belong to an allowed project');
  }
});
```

- [ ] **Step 4: Write test for tags allowlist denial**

Add to the same file:

```typescript
test('returns error when view does not have allowed tags', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: false,
    message: 'The view with LUID test-view-id cannot be queried because it does not have one of the allowed tags.',
  });

  const result = await tool.callback(
    { viewId: 'test-view-id' },
    mockExtra as any
  );

  expect(result.isError).toBe(true);
  if (result.isError) {
    expect(result.content[0].text).toContain('does not have one of the allowed tags');
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tools/web/views/getView.test.ts`
Expected: PASS - All 5 tests pass

- [ ] **Step 6: Commit access control tests**

```bash
git add src/tools/web/views/getView.test.ts
git commit -m "test: add access control tests for get-view tool"
```

---

## Task 5: Add Tests for Lineage Enrichment

**Files:**
- Modify: `src/tools/web/views/getView.test.ts`

- [ ] **Step 1: Write test for successful lineage enrichment**

Add to `src/tools/web/views/getView.test.ts`:

```typescript
test('successfully enriches view with lineage data', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: true,
  });

  const viewWithUsage: View = {
    ...mockView,
    usage: {
      totalViewCount: 100,
    },
  };

  const enrichedView: View = {
    ...viewWithUsage,
    upstreamDatasources: [
      { luid: 'ds-123', name: 'Sales Data' },
      { luid: 'ds-456', name: 'Customer Data' },
    ],
  };

  mockUseRestApi.mockImplementation(async ({ callback }) => {
    const restApi = {
      viewsMethods: {
        getView: vi.fn().mockResolvedValue(viewWithUsage),
      },
      metadataMethods: {
        graphql: vi.fn().mockResolvedValue({
          data: {
            sheetsConnection: {
              nodes: [
                {
                  luid: mockView.id,
                  upstreamDatasources: [
                    { luid: 'ds-123', name: 'Sales Data' },
                    { luid: 'ds-456', name: 'Customer Data' },
                  ],
                },
              ],
            },
          },
        }),
      },
      siteId: 'site-123',
    };
    return await callback(restApi as any);
  });

  const result = await tool.callback(
    { viewId: mockView.id },
    mockExtra as any
  );

  expect(result.isError).toBe(false);
  if (!result.isError) {
    const content = JSON.parse(result.content[0].text);
    expect(content.upstreamDatasources).toBeDefined();
    expect(content.upstreamDatasources).toHaveLength(2);
    expect(content.upstreamDatasources[0].luid).toBe('ds-123');
    expect(content.totalViewCount).toBe(100);
  }
});
```

- [ ] **Step 2: Write test for lineage enrichment failure with graceful fallback**

Add to the same file:

```typescript
test('returns view without lineage when Metadata API fails', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: true,
  });

  const viewWithUsage: View = {
    ...mockView,
    usage: {
      totalViewCount: 50,
    },
  };

  mockUseRestApi.mockImplementation(async ({ callback }) => {
    const restApi = {
      viewsMethods: {
        getView: vi.fn().mockResolvedValue(viewWithUsage),
      },
      metadataMethods: {
        graphql: vi.fn().mockRejectedValue(new Error('Metadata API unavailable')),
      },
      siteId: 'site-123',
    };
    return await callback(restApi as any);
  });

  const result = await tool.callback(
    { viewId: mockView.id },
    mockExtra as any
  );

  expect(result.isError).toBe(false);
  if (!result.isError) {
    const content = JSON.parse(result.content[0].text);
    expect(content.id).toBe(mockView.id);
    expect(content.totalViewCount).toBe(50);
    expect(content.upstreamDatasources).toBeUndefined();
  }
});
```

- [ ] **Step 3: Write test for datasourceIds filtering in lineage**

Add to the same file:

```typescript
test('filters upstream datasources by allowlist', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: true,
  });

  const viewWithUsage: View = {
    ...mockView,
    usage: {
      totalViewCount: 75,
    },
  };

  mockUseRestApi.mockImplementation(async ({ callback }) => {
    const restApi = {
      viewsMethods: {
        getView: vi.fn().mockResolvedValue(viewWithUsage),
      },
      metadataMethods: {
        graphql: vi.fn().mockResolvedValue({
          data: {
            sheetsConnection: {
              nodes: [
                {
                  luid: mockView.id,
                  upstreamDatasources: [
                    { luid: 'ds-allowed', name: 'Allowed DS' },
                    { luid: 'ds-blocked', name: 'Blocked DS' },
                  ],
                },
              ],
            },
          },
        }),
      },
      siteId: 'site-123',
    };
    return await callback(restApi as any);
  });

  const extraWithDatasourceFilter = {
    ...mockExtra,
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      disableMetadataApiRequests: false,
      boundedContext: {
        projectIds: null,
        datasourceIds: new Set(['ds-allowed']),
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  };

  const result = await tool.callback(
    { viewId: mockView.id },
    extraWithDatasourceFilter as any
  );

  expect(result.isError).toBe(false);
  if (!result.isError) {
    const content = JSON.parse(result.content[0].text);
    expect(content.upstreamDatasources).toBeDefined();
    expect(content.upstreamDatasources).toHaveLength(1);
    expect(content.upstreamDatasources[0].luid).toBe('ds-allowed');
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/web/views/getView.test.ts`
Expected: PASS - All 8 tests pass

- [ ] **Step 5: Commit lineage enrichment tests**

```bash
git add src/tools/web/views/getView.test.ts
git commit -m "test: add lineage enrichment tests for get-view tool"
```

---

## Task 6: Add Test for Usage Stats Flattening

**Files:**
- Modify: `src/tools/web/views/getView.test.ts`

- [ ] **Step 1: Write test for usage stats with zero count**

Add to `src/tools/web/views/getView.test.ts`:

```typescript
test('flattens usage stats with zero count when usage is undefined', async () => {
  const tool = getGetViewTool(mockServer);
  
  mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
    allowed: true,
  });

  const viewWithoutUsage: View = {
    ...mockView,
  };

  mockUseRestApi.mockImplementation(async ({ callback }) => {
    const restApi = {
      viewsMethods: {
        getView: vi.fn().mockResolvedValue(viewWithoutUsage),
      },
      siteId: 'site-123',
    };
    return await callback(restApi as any);
  });

  const extraWithDisabledMetadata = {
    ...mockExtra,
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      disableMetadataApiRequests: true,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  };

  const result = await tool.callback(
    { viewId: mockView.id },
    extraWithDisabledMetadata as any
  );

  expect(result.isError).toBe(false);
  if (!result.isError) {
    const content = JSON.parse(result.content[0].text);
    expect(content.totalViewCount).toBe(0);
    expect(content.usage).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/tools/web/views/getView.test.ts`
Expected: PASS - All 9 tests pass

- [ ] **Step 3: Commit usage stats test**

```bash
git add src/tools/web/views/getView.test.ts
git commit -m "test: add usage stats flattening test for get-view tool"
```

---

## Task 7: Register Tool in Tools Factory

**Files:**
- Modify: `src/tools/web/tools.ts`

- [ ] **Step 1: Add import statement**

Add to the imports section of `src/tools/web/tools.ts` (in alphabetical order within the views section):

```typescript
import { getGetViewTool } from './views/getView.js';
```

- [ ] **Step 2: Add to webToolFactories array**

Add to the `webToolFactories` array (in alphabetical order within view-related tools):

```typescript
export const webToolFactories = [
  // ... other tools
  getGetViewTool,  // ADD THIS LINE (after getGetWorkbookTool, before getGetViewDataTool)
  // ... rest of tools
];
```

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build:dev`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit tool registration**

```bash
git add src/tools/web/tools.ts
git commit -m "feat: register get-view tool in web tools factory"
```

---

## Task 8: Run Full Test Suite

**Files:**
- All test files

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests pass, including the 9 new get-view tests

- [ ] **Step 2: Run type check**

Run: `npm run build:dev`
Expected: No TypeScript errors

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No linting errors

- [ ] **Step 4: Commit if any fixes were needed**

If lint fixes were applied:
```bash
git add -A
git commit -m "chore: apply lint fixes for get-view tool"
```

---

## Task 9: Manual Integration Test

**Files:**
- None (runtime testing)

- [ ] **Step 1: Start the MCP server**

Run: `npm run start:http`
Expected: Server starts successfully on port 3927

- [ ] **Step 2: Test the get-view tool with MCP Inspector**

In a new terminal, run: `npm run inspect:http`

Send a tool call:
```json
{
  "name": "get-view",
  "arguments": {
    "viewId": "valid-view-id-from-your-test-server"
  }
}
```

Expected: Returns view metadata with name, workbook, project, owner, tags, totalViewCount, and upstreamDatasources

- [ ] **Step 3: Test access denied scenario**

If you have bounded context configured, test with a view ID that should be blocked.

Expected: Returns error message explaining why access was denied

- [ ] **Step 4: Stop the server**

Stop the MCP server (Ctrl+C)

- [ ] **Step 5: Document manual test results**

Create a commit message noting manual test was successful:
```bash
git commit --allow-empty -m "test: manual integration test passed for get-view tool"
```

---

## Self-Review Checklist

**Spec Coverage:**
- ✅ Access control (Task 4) - covers viewIds, workbookIds, projectIds, tags
- ✅ Fetch view metadata (Task 3) - implemented in main callback
- ✅ Lineage enrichment (Task 5) - with conditional logic and graceful fallback
- ✅ Usage stats flattening (Task 6) - flattenViewUsage function
- ✅ Error handling (Task 4, 5) - ViewNotAllowedError and Metadata API errors
- ✅ Tool registration (Task 1, 7) - toolName.ts and tools.ts
- ✅ Unit tests (Task 2-6) - 9 comprehensive tests

**Placeholder Scan:**
- ✅ No TBD or TODO items
- ✅ All code blocks complete with actual implementation
- ✅ All test assertions specific and complete
- ✅ All file paths exact and absolute

**Type Consistency:**
- ✅ `getGetViewTool` function name used consistently
- ✅ `viewId` parameter name used consistently
- ✅ `View` type from `src/sdks/tableau/types/view.js` used consistently
- ✅ `flattenViewUsage` function signature matches usage
- ✅ All imports reference correct paths

**Implementation Notes:**
- Pattern exactly matches `get-workbook` structure
- Reuses all existing infrastructure (no new utilities)
- Follows TDD with failing test first
- Frequent commits after each task
- Each test is independent and focused
- Graceful error handling throughout
