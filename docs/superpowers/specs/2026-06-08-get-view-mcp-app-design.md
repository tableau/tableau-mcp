# Design: Convert get-view Tool to MCP App

**Date:** 2026-06-08  
**Author:** j.song  
**Status:** Approved

## Overview

Add MCP app support to the `get-view` tool by reusing the existing MCP app infrastructure from `get-workbook`. The tool will display an animated loading UI with chart and sparkle emojis while fetching view data, providing a richer interactive experience for MCP clients that support the ext-apps protocol.

## Background

MCP Apps extend standard MCP tools by registering additional resources (HTML/JavaScript) that clients can render as interactive interfaces. The infrastructure was added in commit `ac786856` with the `get-workbook` implementation, which provides:

- Shared HTML/CSS/TS files for the loading UI
- Build process integration (Vite + vite-plugin-singlefile)
- `getAppConfig()` helper for consistent configuration
- Server-side registration via `registerAppTool()` and `registerAppResource()`

The `get-view` tool currently returns JSON data only. Converting it to an MCP app will allow compatible clients to render a visual loading experience.

## Goals

1. Enable MCP app mode for the `get-view` tool
2. Reuse existing MCP app infrastructure (no new UI files)
3. Maintain backward compatibility (tool works as standard tool when feature disabled)
4. Follow the exact pattern established by `get-workbook`

## Non-Goals

- Custom UI specific to get-view (reuse shared UI)
- Changes to tool callback logic or data structure
- New build configuration (already exists)
- E2E testing of UI rendering (infrastructure already tested)

## Design

### Feature Flag

**File:** `features.json`

```json
{
  "mcp-apps": true
}
```

Currently set to `false`. Change to `true` to enable MCP app registration for all tools with `app` property.

### Tool Changes

**File:** `src/tools/web/views/getView.ts`

**Add import:**
```typescript
import { getAppConfig } from '../../web/apps/appConfig.js';
```

**Add app property to WebTool constructor:**
```typescript
export const getGetViewTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewTool = new WebTool({
    server,
    name: 'get-view',
    description: '...',
    paramsSchema,
    annotations: {
      title: 'Get View',
      readOnlyHint: true,
      openWorldHint: false,
    },
    app: getAppConfig('get-view'),  // <-- ADD THIS LINE
    callback: async ({ viewId }, extra): Promise<CallToolResult> => {
      // ... existing callback logic unchanged
    },
  });

  return getViewTool;
};
```

**No other changes needed.** The callback logic remains identical - the app UI is purely a presentation layer that MCP clients can optionally render.

### Existing Infrastructure (Reused)

These files already exist on main branch and require no changes:

**`src/web/apps/appConfig.ts`**
- Helper function `getAppConfig(toolName)` that returns:
  - `name`: Tool-specific app name (e.g., `"get-view-ui"`)
  - `resourceUri`: URI clients use to fetch HTML (`"ui://get-view/mcp-app.html"`)
  - `htmlPath`: Path to built HTML file (`"web/apps/dist/mcp-app.html"`)

**`src/web/apps/mcp-app.html`**
- Shared loading screen HTML with animated emojis (📊✨🌟)
- Vite entry point: `<script type="module" src="/src/mcp-app.ts">`

**`src/web/apps/src/mcp-app.ts`**
- TypeScript logic for the loading UI
- Handles theme, animations, message display

**`src/web/apps/src/mcp-app.css`**
- Styles for the loading screen
- Emoji animations (bounce, rotation)

### Server Registration Logic

**File:** `src/server.web.ts` (no changes needed)

The server already handles MCP app registration:

```typescript
// Line 40: Check feature flag
const mcpAppsEnabled = getFeatureGate().isFeatureEnabled('mcp-apps');

// Lines 93-97: Register as app tool or standard tool
if (mcpAppsEnabled && tool.app) {
  await this._registerAppTool(tool, toolCallback);
} else {
  await this._registerTool(tool, toolCallback);
}
```

When `mcp-apps` is enabled and `tool.app` exists:
1. `_registerAppTool()` calls `registerAppTool()` with `_meta.ui.resourceUri`
2. `_registerAppResource()` calls `registerAppResource()` to serve the HTML
3. MCP clients can fetch the HTML from the resource URI and render it

When disabled or `tool.app` is undefined, tool registers as standard JSON-only tool.

### Build Process

**File:** `src/scripts/build.ts` (no changes needed)

Vite build already configured to:
1. Bundle `src/web/apps/mcp-app.html` into a single-file HTML (via `vite-plugin-singlefile`)
2. Output to `web/apps/dist/mcp-app.html`
3. Copy to `build/` directory for runtime access

### Data Flow

1. **Tool Registration (startup):**
   - Server reads `features.json` → `mcp-apps: true`
   - Server creates `get-view` tool with `app: getAppConfig('get-view')`
   - Server calls `registerAppTool()` with `_meta.ui.resourceUri = "ui://get-view/mcp-app.html"`
   - Server calls `registerAppResource()` to handle resource fetch

2. **Tool Invocation (runtime):**
   - Client calls `get-view` tool with `{ viewId: "abc123" }`
   - Client sees `_meta.ui.resourceUri` in tool schema
   - Client fetches resource via `resources/read` request
   - Server returns bundled HTML from `web/apps/dist/mcp-app.html`
   - Client renders HTML in webview (loading screen appears)
   - Server executes callback, fetches view data, returns JSON
   - Client receives JSON and handles display (app-specific)

3. **Backward Compatibility:**
   - If `mcp-apps: false`, tool registers without `_meta.ui`
   - Clients receive JSON response only (standard MCP tool behavior)
   - No breaking changes for existing integrations

## Implementation Steps

1. Check out `get-view-tool` branch
2. Add `app: getAppConfig('get-view')` to getView.ts
3. Add import for `getAppConfig`
4. Update `features.json` to enable `mcp-apps`
5. Run unit tests to verify no regressions
6. Run build to verify no TypeScript errors
7. Commit changes (do not push per user request)

## Testing Strategy

### Unit Tests
- Existing `getView.test.ts` should pass unchanged
- Tool behavior identical whether registered as app or standard tool
- No new unit tests required (app registration tested in `server.web.test.ts`)

### Manual Verification
1. **Feature flag disabled:**
   - Set `"mcp-apps": false`
   - Build and start server
   - Verify tool works as standard tool (JSON only)

2. **Feature flag enabled:**
   - Set `"mcp-apps": true`
   - Build and start server
   - Verify tool registers with `_meta.ui.resourceUri`
   - Verify resource fetch returns HTML
   - (Client rendering requires MCP client with ext-apps support)

### Regression Testing
- All existing tests must pass
- Build must succeed with no TypeScript errors
- Lint must pass with no new violations

## Security Considerations

- No new security concerns (reusing tested infrastructure)
- HTML is statically bundled at build time (no dynamic content injection)
- Resource URI uses `ui://` scheme (client-side protocol, not HTTP)
- Tool callback performs same access control checks as before

## Performance Considerations

- Negligible impact: app registration adds ~1-2 resource entries
- HTML bundle is ~15-20KB (single-file, inline CSS/JS)
- Served from memory (read once at startup)
- No impact on tool execution speed (callback unchanged)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feature flag accidentally left enabled | Users without ext-apps clients see different tool schema | Document flag clearly; default to false in production |
| Shared HTML conflicts between tools | UI looks wrong for get-view | Acceptable - shared UI is intentional per user requirement |
| Build process breaks | MCP app not available | Build verification step; fail fast if HTML not generated |

## Future Enhancements

Not in scope for this change, but possible future work:

- Tool-specific UI customization (different content per tool)
- Interactive UI elements (buttons, forms, filters)
- Real-time data updates (streaming)
- Client-side data visualization

## References

- Commit `ac786856`: MCP app infrastructure and get-workbook implementation
- `src/server.web.ts`: App registration logic
- `src/tools/web/workbooks/getWorkbook.ts`: Reference implementation
- `@modelcontextprotocol/ext-apps` package: MCP app protocol
