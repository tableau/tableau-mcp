# W-24061219: Gate MCP-Apps tool registration on client capability

## Source

- Ticket: GUS W-24061219 (https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002jTxXKYA0/view)
- Slack:
- Google Docs/Drive:
- Owner: Jaehun Song
- Date: 2026-08-28 (round 1) — 2026-08-31 (hideWhenUnsupported follow-up)
- Related PRs/issues: https://github.com/tableau/tableau-mcp/pull/861

## Intent

Don't hand a client an interactive MCP-Apps tool it has no way to render. Today,
app-tool vs. plain-tool registration depends solely on the server-side `mcp-apps`
feature flag — it ignores what the connecting client actually advertised. Clients that
don't support MCP-Apps rendering should transparently get the plain-tool fallback (or,
for `render-interactive-viz` specifically, no tool at all — a degraded plain-tool
fallback isn't a useful experience for that one).

## Problem

- `WebMcpServer.registerTools` (`src/server.web.ts`) branched only on `mcpAppsEnabled && tool.app`. Any client connecting with the flag on got app tools regardless of its own SEP-1724 `extensions["io.modelcontextprotocol/ui"]` capability.
- claude.ai (OAuth/HTTP) advertises the UI capability but has a broken MCP-Apps renderer, so it needed an explicit deny-list entry independent of capability detection.
- `render-interactive-viz` specifically has no useful plain-tool fallback (rendering a viz without an interactive embed isn't the same feature) — needed a way to disappear entirely for unsupported clients instead of degrading.

## Acceptance criteria

- [x] Client capability (`extensions["io.modelcontextprotocol/ui"]` at `initialize`, checked via `clientSupportsMcpApps`) gates app-tool registration, ANDed with the existing `mcp-apps` feature flag.
- [x] claude.ai (`getClientDisplayName(clientId) === 'Claude'`) is force-excluded from app-tool registration regardless of advertised capability.
- [x] Unsupported/unknown clients safely fall back to plain-tool registration (default-safe).
- [x] `capabilities`/`clientId` threaded end-to-end for the HTTP stateful-session path (`Server`, `WebMcpServer`, `Session`, `express.ts`), mirroring the existing `clientInfo` pattern.
- [x] Stateless-HTTP-mode limitation (capabilities only present on the literal `initialize` body, so live detection never activates for real per-request traffic in that mode) is explicitly documented, not silently left as a gap.
- [x] `render-interactive-viz` is hidden entirely (no tool, no resource) — not just downgraded to plain — for clients that fail the app-tool gate, via a new opt-in `AppDetails.hideWhenUnsupported` field.
- [x] Other app tools (`update-cloud-extract-refresh-task`, `delete-content`) are unaffected — they keep falling back to plain tools as before.

## Non-goals

- Do not implement the `oninitialized`-based post-registration upgrade path (removing and re-registering tools after handshake via `listChanged`) — separate, larger change.
- Do not attempt capability detection for stdio or stateless-HTTP transports beyond the documented safe-default fallback.
- Do not change `getAppConfig()` itself to carry `hideWhenUnsupported` — it's a generic lookup shared by multiple tools; the flag is set per-call-site via object spread instead.
- Do not modify `getClientDisplayName`/`clientDisplayName.ts` — reused as-is.

## Constraints

- Compatibility: default behavior for unknown/absent capability must remain today's plain-tool registration — no client that currently works should regress.
- Performance: capability check is a pure in-memory lookup on already-parsed `initialize` data; no new I/O.
- Security/privacy: `clientId` is attacker-influenceable but used only for host-based display-name matching; worst case of a mismatch is an unwanted plain-tool downgrade, not a privilege or exposure issue.
- UX/API behavior: no plain-tool fallback should ever silently look broken — either it renders correctly as a plain tool, or (for `render-interactive-viz`) it's absent from the tool list entirely.
- Rollout: gated behind the existing `mcp-apps` feature flag; no independent flag for the capability gate itself.

## Risk classification

low

Reason: additive/defensive gating on top of an already-flagged feature; default-safe fallback preserves current behavior for every client that doesn't advertise the new capability signal. Went through 3 rounds of dual-reviewer + synthesis review before landing (see plan doc), including a dedicated round for the `hideWhenUnsupported` follow-up.

## Test plan

- Unit: `src/server.web.test.ts` (capable client → app tool; missing/lacking capability → plain; flag off → plain; claude.ai clientId → plain despite otherwise qualifying; non-Claude known client (Cursor) → app tool; `hideWhenUnsupported` cases — absent entirely when ungated, still registers as app tool when capable). `src/server/mcpUiCapability.test.ts` (new — `clientSupportsMcpApps` unit tests). `src/tools/web/renderInteractiveViz/renderInteractiveViz.test.ts` (asserts `tool.app?.hideWhenUnsupported === true`).
- Integration: n/a beyond the above — no separate integration harness for tool registration.
- E2E/manual: connect a UI-capable client, a plain client, and a simulated claude.ai `client_id` via MCP Inspector with custom `initialize` capabilities payloads; confirm registration behavior for each.
- Regression: `npx vitest run` full suite (177 files / 2845 tests passing at last check); `npm run build` (default + MCP Apps + tracing bundles).

## Implementation notes

See `plans/gate-mcp-apps-registration-by-client-capability.md` for the full design writeup
(registration timing, gate composition, threading, and the `hideWhenUnsupported` follow-up).

## Open questions / conflicts

- None open. Package.json version on the branch briefly diverged to an unexpected `4.6.0`
  from a merge-conflict resolution (branch had bumped to 4.8.0, main was at 4.5.8) — flagged
  for the PR author to confirm the intended version before merge, not a design conflict.

## Final evidence

- Files changed: `src/server.web.ts`, `src/server.ts`, `src/server/express.ts`,
  `src/sessions.ts`, `src/server/mcpUiCapability.ts` (new), `src/tools/web/tool.ts`,
  `src/tools/web/renderInteractiveViz/renderInteractiveViz.ts`, plus test files for each,
  `docs/docs/configuration/mcp-config/env-vars.md`.
- Checks run: `npx vitest run` (177 files / 2845 tests, exit 0), `npm run build` (exit 0).
- Review result: 3 rounds dual-reviewer + synthesis for the base gate, canonical
  `VERDICT: PASS` each round; separate dual-reviewer + synthesis round for
  `hideWhenUnsupported`, canonical `VERDICT: PASS`.
- Security result: no new trust boundary; `clientId` misuse worst-case is a UX downgrade, not
  an access-control issue.
- Remaining risks: stateless-HTTP-mode app-tool activation gap is a known, documented,
  accepted limitation — not a defect to track further unless product requirements change.
