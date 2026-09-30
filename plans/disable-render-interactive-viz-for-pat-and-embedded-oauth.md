# Disable `render-interactive-viz` for PAT and embedded-OAuth auth modes

## Context

`render-interactive-viz` (`/Users/j.song/work/orchestrator/tableau-mcp/src/tools/web/renderInteractiveViz/renderInteractiveViz.ts`) renders a live, interactive embedded Tableau viz using the MCP-Apps embed flow. Today it is gated only on the `mcp-apps` feature flag:

```ts
disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('mcp-apps'))),
```

The interactive embed relies on auth flows that can mint/refresh a session-scoped token suitable for the client-side embed (Bearer from a real Tableau-hosted OAuth authz server, or a JWT via UAT/direct-trust). Two auth configurations don't fit that model and should disable the tool:
- **`pat`** — PAT credentials aren't usable for the embed handoff.
- **embedded OAuth** — when this MCP server is itself acting as the OAuth authorization server (`config.oauth.embeddedAuthzServer === true`, as opposed to delegating to Tableau's own authz server), there's no external Tableau-hosted session to hand to the embed.

The user's requirement: disable render-interactive-viz for PAT and for embedded-OAuth mode (not for delegated/Tableau-authz-server OAuth, nor for uat/direct-trust).

## Change

**File:** `src/tools/web/renderInteractiveViz/renderInteractiveViz.ts`

1. Import `getConfig` from `../../../config.js` and call it once inside `getRenderInteractiveVizTool` (mirrors `revokeAccessToken.ts:4,30`).
2. Extend the existing `disabled` Provider to also check auth mode, combining with the current feature-gate check (mirrors the combined-condition pattern in `src/tools/web/_lib/confirmDeleteContent.ts:45-48`):

```ts
disabled: new Provider(
  async () =>
    !(await getFeatureGate().isFeatureEnabled('mcp-apps')) ||
    config.auth === 'pat' ||
    (config.auth === 'oauth' && config.oauth.embeddedAuthzServer),
),
```

No other files need to change — `WebMcpServer` (`src/server.web.ts:135`) already resolves `tool.disabled` via `Provider.from` and skips registration when `true`; this is the sole registration-filtering mechanism (confirmed via `revokeAccessToken.ts`'s identical `config.auth`-based precedent).

## Tests

**File:** `src/tools/web/renderInteractiveViz/renderInteractiveViz.test.ts`

Add a `describe('disabled property', ...)` block mirroring `revokeAccessToken.test.ts:39-65`, using `stubDefaultEnvVars()` (already imported/used in this file) plus env stubs for each case:

- disabled when `AUTH=pat` (default test env) and `mcp-apps` feature is on
- disabled when `AUTH=oauth` and `OAUTH_EMBEDDED_AUTHZ_SERVER=true`
- enabled when `AUTH=oauth` and `OAUTH_EMBEDDED_AUTHZ_SERVER=false` (delegated to Tableau authz server), with `mcp-apps` on
- enabled when `AUTH=uat` or `AUTH=direct-trust`, with `mcp-apps` on
- still disabled regardless of auth type when the `mcp-apps` feature gate is off (existing behavior, just confirm it still composes correctly)

Use `await Provider.from(tool.disabled)` to resolve, and mock/stub the feature gate the same way the existing tests in this file already do (check current file for the feature-gate mocking pattern — if none exists yet, may need `vi.mock('../../../features/init.js', ...)` or to rely on default `features.json`/env-based provider behavior already exercised by `stubDefaultEnvVars()`).

## Verification

- `npx vitest run src/tools/web/renderInteractiveViz/renderInteractiveViz.test.ts`
- `npx vitest run` (full suite) to ensure no regressions elsewhere (e.g. any test currently asserting render-interactive-viz is enabled under default test env, which is PAT — that assumption will now flip since PAT disables it, so search for and update any such assertions)
- `npx tsc --noEmit`
