# Convert get-view Tool to MCP App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP app support to the `get-view` tool by reusing existing MCP app infrastructure from main branch

**Architecture:** Import the MCP app configuration helper and add the `app` property to the WebTool constructor. Enable the `mcp-apps` feature flag to activate app registration for all tools with app metadata. The server will automatically register the tool with UI metadata when the flag is enabled.

**Tech Stack:** TypeScript, MCP SDK, @modelcontextprotocol/ext-apps, Vite (for app bundling)

---

## File Structure

This implementation will modify/create the following files:

- **Merge from main:** MCP app infrastructure (HTML/CSS/TS, appConfig helper, build config)
- **Modify:** `src/tools/web/views/getView.ts` - Add app property to tool
- **Modify:** `features.json` - Enable mcp-apps feature flag
- **Test:** `src/tools/web/views/getView.test.ts` - Verify existing tests still pass

---

## Task 1: Merge MCP App Infrastructure from Main

**Files:**
- Merge: All MCP app files from main branch (commit `ac786856`)
- Creates: `src/web/apps/appConfig.ts`, `src/web/apps/mcp-app.html`, `src/web/apps/src/mcp-app.{ts,css}`
- Modifies: `src/server.web.ts`, `src/tools/web/tool.ts`, `src/scripts/build.ts`, `package.json`

- [ ] **Step 1: Ensure clean working directory**

Run: `git status`
Expected: "nothing to commit, working tree clean"

- [ ] **Step 2: Merge main branch**

```bash
git merge origin/main --no-commit
```

Expected: Merge conflicts in `package.json` and `package-lock.json` (version numbers)

- [ ] **Step 3: Resolve package.json conflict**

Accept incoming changes for dependencies but keep current version number if needed. Open `package.json` and resolve conflict markers.

Expected: Clean version without `<<<<<<<`, `=======`, `>>>>>>>` markers

- [ ] **Step 4: Resolve package-lock.json conflict**

```bash
npm install
```

This regenerates `package-lock.json` with merged dependencies.

Expected: `package-lock.json` updated, no conflict markers

- [ ] **Step 5: Stage resolved files**

```bash
git add package.json package-lock.json
```

- [ ] **Step 6: Verify MCP app files exist**

```bash
ls -la src/web/apps/
```

Expected output showing:
- `appConfig.ts`
- `mcp-app.html`
- `src/mcp-app.ts`
- `src/mcp-app.css`

- [ ] **Step 7: Complete merge commit**

```bash
git commit --no-gpg-sign -m "chore: merge MCP app infrastructure from main

- Add MCP app UI structure (HTML/CSS/TS)
- Add getAppConfig helper for tool registration
- Integrate Vite build for MCP apps
- Update getWorkbook to use MCP app
- Add OAuth resource identifier support
- Update build scripts and configs"
```

Expected: Merge commit created

---

## Task 2: Add App Configuration to get-view Tool

**Files:**
- Modify: `src/tools/web/views/getView.ts`

- [ ] **Step 1: Read current getView.ts implementation**

```bash
cat src/tools/web/views/getView.ts | head -20
```

Verify current imports and structure.

- [ ] **Step 2: Add getAppConfig import**

Add to the import section (after line 11, before resourceAccessChecker import):

```typescript
import { getAppConfig } from '../../../web/apps/appConfig.js';
```

The imports section should look like:

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
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
```

- [ ] **Step 3: Add app property to WebTool constructor**

In the `getGetViewTool` function, add `app: getAppConfig('get-view'),` after the `annotations` property:

```typescript
export const getGetViewTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewTool = new WebTool({
    server,
    name: 'get-view',
    description:
      'Retrieves information about the specified view, including upstream datasources, workbook information, project details, owner, tags, and usage statistics.',
    paramsSchema,
    annotations: {
      title: 'Get View',
      readOnlyHint: true,
      openWorldHint: false,
    },
    app: getAppConfig('get-view'),
    callback: async ({ viewId }, extra): Promise<CallToolResult> => {
      // ... existing callback code unchanged
    },
  });

  return getViewTool;
};
```

- [ ] **Step 4: Verify changes with git diff**

```bash
git diff src/tools/web/views/getView.ts
```

Expected: Shows +2 lines (import and app property)

- [ ] **Step 5: Run linter to auto-fix formatting**

```bash
npx eslint --fix src/tools/web/views/getView.ts
```

Expected: Linter may adjust import formatting (multi-line)

- [ ] **Step 6: Verify linting passes**

```bash
npx eslint src/tools/web/views/getView.ts
```

Expected: No output (clean lint)

- [ ] **Step 7: Commit changes**

```bash
git add src/tools/web/views/getView.ts
git commit --no-gpg-sign -m "feat: add MCP app support to get-view tool

- Import getAppConfig helper
- Add app property to WebTool constructor
- Tool will register with UI metadata when mcp-apps flag enabled"
```

---

## Task 3: Enable MCP Apps Feature Flag

**Files:**
- Modify: `features.json`

- [ ] **Step 1: Read current features.json**

```bash
cat features.json
```

Expected:
```json
{
  "mcp-apps": false
}
```

- [ ] **Step 2: Enable mcp-apps flag**

Change `false` to `true`:

```json
{
  "mcp-apps": true
}
```

- [ ] **Step 3: Verify change**

```bash
git diff features.json
```

Expected:
```diff
 {
-  "mcp-apps": false
+  "mcp-apps": true
 }
```

- [ ] **Step 4: Commit change**

```bash
git add features.json
git commit --no-gpg-sign -m "feat: enable mcp-apps feature flag

Activates MCP app registration for tools with app property.
When enabled, get-view will register with UI metadata pointing to
the shared MCP app HTML resource."
```

---

## Task 4: Verify Implementation

**Files:**
- Test: `src/tools/web/views/getView.test.ts`
- Verify: Build and lint

- [ ] **Step 1: Run get-view unit tests**

```bash
npx vitest run src/tools/web/views/getView.test.ts
```

Expected output:
```
✓ src/tools/web/views/getView.test.ts (10 tests)
  ✓ should create tool with correct properties
  ✓ successfully fetches view metadata
  ✓ returns error when view not in viewIds allowlist
  ✓ returns error when workbook not in workbookIds allowlist
  ✓ returns error when project not in projectIds allowlist
  ✓ returns error when tags not in tags allowlist
  ✓ successfully fetches view metadata without enrichment when Metadata API is disabled
  ✓ enriches view with lineage when Metadata API is enabled
  ✓ returns view without lineage when Metadata API enrichment fails
  ✓ filters upstream datasources by allowlist

Test Files  1 passed (1)
     Tests  10 passed (10)
```

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass with total count shown (e.g., "Tests  1457 passed (1457)")

- [ ] **Step 3: Verify TypeScript compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: No output (successful type check)

Note: `--skipLibCheck` avoids dependency type errors

- [ ] **Step 4: Run linter on modified files**

```bash
npx eslint src/tools/web/views/getView.ts features.json
```

Expected: No output (clean lint)

- [ ] **Step 5: Verify implementation with git log**

```bash
git log --oneline -5
```

Expected output showing:
```
<hash> feat: enable mcp-apps feature flag
<hash> feat: add MCP app support to get-view tool
<hash> chore: merge MCP app infrastructure from main
<hash> chore: remove plan and spec docs from PR
<hash> bump
```

- [ ] **Step 6: Show final diff summary**

```bash
git diff origin/get-view-tool --stat
```

Expected: Shows all changes since last push (merge + get-view changes + feature flag)

---

## Task 5: Manual Verification (Optional)

**Files:**
- N/A (runtime verification)

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Build completes successfully, creates `build/` directory with bundled code

- [ ] **Step 2: Check MCP app HTML was built**

```bash
ls -lh build/web/apps/dist/mcp-app.html
```

Expected: File exists, ~15-20KB single-file HTML bundle

- [ ] **Step 3: Start server (optional)**

```bash
npm run start:http
```

Expected: Server starts on port 3927 (or configured port)

- [ ] **Step 4: Verify tool registration (optional)**

Connect MCP client and check `get-view` tool schema includes:
```json
{
  "_meta": {
    "ui": {
      "resourceUri": "ui://get-view/mcp-app.html"
    }
  }
}
```

Note: Requires MCP client with ext-apps support

- [ ] **Step 5: Test with feature flag disabled (optional)**

```bash
# Set mcp-apps: false in features.json
npm run start:http
```

Verify `get-view` tool schema does NOT include `_meta.ui` property

---

## Verification Checklist

Implementation is complete when:

- [x] MCP app infrastructure merged from main
- [x] `src/web/apps/appConfig.ts` exists and exports `getAppConfig()`
- [x] `getView.ts` imports `getAppConfig` and uses it in `app` property
- [x] `features.json` has `"mcp-apps": true`
- [x] All 10 get-view unit tests pass
- [x] Full test suite passes
- [x] TypeScript compilation succeeds (no type errors)
- [x] Linting passes on modified files
- [x] Git commits show all changes (3 commits total)

---

## Success Criteria

**Functional:**
- `get-view` tool registers with `_meta.ui.resourceUri` when `mcp-apps: true`
- Tool registers as standard tool (no UI metadata) when `mcp-apps: false`
- MCP clients can fetch HTML resource via `resources/read` request
- Tool callback behavior unchanged (returns same JSON data)

**Testing:**
- All existing unit tests pass (10/10)
- No new unit tests required (app registration tested in `server.web.test.ts`)
- No regressions in full test suite

**Code Quality:**
- No TypeScript errors
- Linting passes
- Follows established pattern from `get-workbook` tool

---

## Rollback Plan

If issues arise, rollback steps:

1. **Disable feature flag:**
   ```bash
   # Set features.json: "mcp-apps": false
   git checkout features.json
   ```

2. **Revert get-view changes:**
   ```bash
   git revert <commit-hash-for-get-view-app>
   ```

3. **Revert merge (if needed):**
   ```bash
   git revert -m 1 <merge-commit-hash>
   ```

4. **Force push if already pushed:**
   ```bash
   git push --force-with-lease
   ```

---

## Implementation Notes

- **DO NOT PUSH** unless explicitly requested by user
- The implementation reuses shared MCP app UI (same HTML/CSS/TS as `get-workbook`)
- No custom UI needed - the loading screen is generic
- Feature flag allows gradual rollout (can disable without code changes)
- Backward compatible - tools work as standard tools when flag is off
- Build process already configured (no build script changes needed)
