# Gate MCP-Apps tool registration on client capability + known-incompatible clients, not just the feature flag

## Context

tableau-mcp's `WebMcpServer.registerTools` (`src/server.web.ts`) decided whether to
register a tool as an interactive "MCP App" (`_registerAppTool`, using
`@modelcontextprotocol/ext-apps`) or as a plain tool (`_registerTool`), based solely on the
server-side `mcp-apps` feature flag:

```ts
if (mcpAppsEnabled && tool.app) {
  await this._registerAppTool(tool, toolCallback);
} else {
  await this._registerTool(tool, toolCallback);
}
```

There was no check of whether the **connecting client** actually supports rendering MCP Apps.
If the flag is on, every client — including ones with no MCP-Apps UI support — got an app
tool it couldn't render. The MCP protocol has a real mechanism for this: during the
`initialize` handshake, a capable client advertises
`ClientCapabilities.extensions["io.modelcontextprotocol/ui"] = { mimeTypes: [...] }` (must
include `"text/html;profile=mcp-app"`). `@modelcontextprotocol/ext-apps` (already a repo
dependency) exposes `getUiCapability(clientCapabilities)` to read this. This plan added
client-capability as a second, orthogonal gate next to the feature flag, defaulting to the
safe (plain-tool) fallback whenever the client's support is unknown or absent.

Separately, there's a known rendering bug specific to **claude.ai** connecting over
OAuth/HTTP: even when it correctly advertises the UI capability, its MCP-Apps renderer is
broken, so it needs to be force-disabled regardless of what it declares. This repo already
had the exact mapping needed for this: `getClientDisplayName(clientId)`
(`src/telemetry/clientDisplayName.ts`) maps an OAuth `client_id` (a CIMD URL) to a friendly
name via a host lookup table, and `'claude.ai' → 'Claude'` is already in that table.

## Design

### 1. Registration timing

`registerTools()` runs before `mcpServer.connect(transport)` at every call site (stdio,
combined, desktop, and both HTTP branches in `express.ts`). For the **stateful HTTP session
path** — the realistic path for any real MCP-Apps client — `express.ts` already parses the
raw `initialize` request body synchronously and pulls `req.body.params.clientInfo` out of it
before `WebMcpServer` is constructed. `req.body.params.capabilities` sits right next to it.
So no lifecycle change was needed for this path — `capabilities` threads through the same
dual-path pattern `clientInfo` already used.

**Scope shipped:** the HTTP stateful-session path (Tier 1) — the case that matters, since
MCP-Apps clients connect over HTTP. For stdio and stateless-HTTP, default to "unsupported" →
plain tool (safe by construction). The `oninitialized`-based post-registration upgrade
(`RegisteredTool.remove()` + re-registration + `listChanged`) was explicitly **not**
implemented — materially separate change, not needed to close the actual gap.

**Known, documented limitation (accepted in round 2 review):** in stateless HTTP mode
(`DISABLE_SESSION_MANAGEMENT=true`), a fresh server/transport is created and torn down per
request, and `capabilities` is only ever present on the literal `initialize` request body —
so live capability detection never activates app tools for real tool-call traffic in that
mode; it always safely falls back to plain tools. Documented in a code comment
(`src/server/express.ts`) and `docs/docs/configuration/mcp-config/env-vars.md`
(`DISABLE_SESSION_MANAGEMENT`) rather than left as a silent gap. The claude.ai exclusion is
unaffected since it's keyed on `clientId`, available on every request.

### 2. Composing with existing gates

`tool.disabled` (`_getToolsToRegister`) decides whether a tool is registered *at all* —
untouched by this change. `clientSupportsMcpApps` and `isKnownIncompatibleClient` are ANDed
onto the existing app/plain branch:

```ts
if (mcpAppsEnabled && tool.app && supportsMcpApps && !isKnownIncompatibleClient) {
  await this._registerAppTool(tool, toolCallback);
} else if (tool.app?.hideWhenUnsupported) {
  continue;
} else {
  await this._registerTool(tool, toolCallback);
}
```

`isKnownIncompatibleClient` is `getClientDisplayName(this.clientId) === 'Claude'` — reusing
the existing telemetry mapping rather than a new claude.ai string constant.

### 3. New helper module

`src/server/mcpUiCapability.ts` exports:
- `ClientCapabilitiesWithUiExtension` — the SEP-1724-pending widened type
  (`ClientCapabilities & { extensions?: Record<string, unknown> }`), a single greppable seam
  to delete once the SDK core type absorbs `extensions`.
- `clientSupportsMcpApps(capabilities): boolean` — wraps `getUiCapability` from
  `@modelcontextprotocol/ext-apps/server` and checks
  `uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)`.

No new module for the claude.ai check — it reuses `getClientDisplayName`.

### 4. Threading capabilities and clientId end-to-end

Mirrors the existing `clientInfo` pattern for both new values across `src/server.ts`,
`src/sessions.ts`, `src/server/express.ts`, and `src/server.web.ts` (constructor + gating
computation in `registerTools`).

### 5. Follow-up: app-only tools (`hideWhenUnsupported`)

After the base gate shipped, a follow-up request asked for `render-interactive-viz`
specifically to be **hidden entirely** — not fall back to a plain tool — for clients that
can't render MCP Apps (the plain-tool fallback for a viz-rendering tool isn't a useful
degraded experience). Added an opt-in `hideWhenUnsupported?: boolean` field to `AppDetails`
(`src/tools/web/tool.ts`), set only at the `render-interactive-viz` call site via object
spread (`{ ...getAppConfig('render-interactive-viz'), hideWhenUnsupported: true }`) rather
than inside `getAppConfig` itself, since `getAppConfig` is a generic lookup shared by
`update-cloud-extract-refresh-task` and `delete-content`, which must keep falling back to
plain tools. The registration loop's `else if (tool.app?.hideWhenUnsupported) continue;`
branch (see §2) implements the "hide, don't fall back" behavior; other app tools are
unaffected since their `AppDetails` never set the field.

## Critical files
- `src/server.web.ts` — main gating logic
- `src/server.ts` — base `Server` class, `capabilities`/`clientId` alongside `clientInfo`
- `src/server/express.ts` — threads `req.body.params.capabilities` and `req.auth?.clientId`
- `src/sessions.ts` — `capabilities`/`clientId` on `Session`/`createSession`
- `src/server/mcpUiCapability.ts` (new) — `clientSupportsMcpApps` helper + widened type
- `src/telemetry/clientDisplayName.ts` — reused as-is
- `src/tools/web/tool.ts` — `AppDetails.hideWhenUnsupported`
- `src/tools/web/renderInteractiveViz/renderInteractiveViz.ts` — opts into `hideWhenUnsupported`
- `src/server.web.test.ts`, `src/server/mcpUiCapability.test.ts`,
  `src/tools/web/renderInteractiveViz/renderInteractiveViz.test.ts`

## Verification
- `npx vitest run` (full suite) — 177 files / 2845 tests passing at last check.
- `npm run build` — default + MCP Apps + tracing bundles.
- Manual: connect a UI-capable client with the flag on → app tools register; connect a plain
  client (no extension) with the flag on → plain-tool fallback; simulate `client_id` of
  `https://claude.ai/...` with the flag on and UI capability present → still falls back to
  plain despite otherwise qualifying; `render-interactive-viz` specifically → absent entirely
  (no tool, no resource) for any client that fails the app-tool gate.
- Went through 3 rounds of dual-reviewer + synthesis review (round 1: fixed stateless-branch
  threading regression; round 2: confirmed/accepted the stateless-mode limitation; round 3:
  documented it), plus a separate dual-reviewer + synthesis round for the `hideWhenUnsupported`
  follow-up. All rounds: canonical `VERDICT: PASS`.

## Status

Shipped. PR: https://github.com/tableau/tableau-mcp/pull/861
(`feat/mcp-apps-client-capability-gate-v2` → `main`, GUS: W-24061219).
