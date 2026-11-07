# W-24280234: CABU MCP implementation

## Source

- Ticket: W-24280234 ("CABU MCP implementation", 8 pts, sprint 2026.11a-ACE AI Experiences, epic "[264.4] CABU MCP")
- Slack: #tab-dev-mcp-contrib (C0BKN8XDNFQ) for Tableau MCP contribution
- Google Docs/Drive: Seb Martel's "CABU on Tableau MCP: Technical Overview" 1-pager
- Owner: Geoff Rosenberg (reassigned from Seb Martel 2026-11-03)
- Date: 2026-11-04
- Related PRs/issues: none yet filed; this is the first PR against tableau/tableau-mcp for this epic

## Intent

Let any MCP client (Claude, Slack, Agentforce) drive a multi-turn CABU
(Tableau Agent's dashboard/datasource Q&A) conversation headlessly through
Tableau MCP, instead of only inside an interactive Tableau session. This
unblocks the epic's only acceptance criterion: "Working demo of tableau MCP
with cabu."

## Problem

CABU today is reachable only from Tableau's own UI session. The CES REST
surface under `/content-exploration/analytics-assistant/cabu/` is otherwise
headless-capable (proven externally by tua-gaia's `TabCabuServiceClient` and
`cabu_perf`'s `cabu-ask.sh`), but there is no MCP tool that exposes it, and
the protocol has two properties that don't map cleanly onto MCP's per-call
tool model:

- a 4-call choreography per turn (start conversation once, then per-utterance
  POST + SSE GET), where tableau-mcp currently builds one isolated REST
  client per tool call with no slot for cross-call state;
- a server-minted `cabuCtx` context cookie, refreshed each turn, that (absent
  the `AnalyticsAssistantCabuContextRedisPrimary` server flag) the next turn
  needs replayed back, with no in-repo precedent for carrying cookies across
  tool invocations or for consuming a streaming SSE response at all.

## Acceptance criteria

- [x] A `cabu-start-conversation` tool starts a CABU conversation against a
      PDS (published datasource) and returns a `conversationId` plus an
      opaque `utteranceArgs` token carrying the invariant per-conversation
      fields.
- [x] A `cabu-ask` tool sends an utterance, drains the SSE stream to
      `complete`, and returns an assembled answer (response text, any
      datatables as truncated markdown, a `dataDetails` summary, and
      `nextParentLuid` for threading the next question).
- [x] Turn 2+ demonstrably uses prior-turn context (e.g. "now just the West
      region" correctly narrows the prior answer) in a live 3-turn
      conversation run through Claude Code/Desktop against a real CABU-
      enabled Tableau Cloud site. Run 2026-11-05 via headless `claude -p`
      against `tableauagent1`/test-dataplane1 — see
      `.work/reports/W-24280234-phase2-cabu-demo.md`.
- [x] CES-side errors (`error_code`/`error_details` on the `error` SSE event,
      and non-2xx from the two POSTs) surface as clear tool errors, not raw
      stack traces. (`CabuResponseError`, `CabuStreamIncompleteError` in
      `src/errors/mcpToolError.ts`.)
- [x] Both tools are off by default (new `tableau-agent` tool group, gated
      like other optional groups) so existing tableau-mcp users are
      unaffected. (`TABLEAU_AGENT_TOOLS_ENABLED` in `src/config.ts`; group
      defined in `src/tools/web/toolName.ts`.)
- [x] Unit tests cover request-body construction, SSE parsing (multi-line
      `data:`, `error` event, missing terminal `complete`, timeout),
      answer assembly, `utteranceArgs` round-trip, and `parentLuid`
      threading.

## Non-goals

- Do not change: anything in the monolith/CES (`war-content-exploration`,
  `tabhf-content-exploration`). The PDS path is already headless; no server
  change is required for this demo.
- Do not implement: workbook-embedded-datasource conversations. These need
  CES changes (`validateWorkbookDatasourceRequirements`,
  `scanWorkbookForRls`, `fetchSessionWorkbook`'s session dependency) that are
  explicitly out of scope — tracked as a follow-up story instead.
- Do not implement: the `GET sampling/stream` endpoint, chart rendering, or
  the `AnalyticsAssistantCabuContextRedisPrimary` rollout itself.
- Do not modify: existing tool groups, existing SDK methods classes, or the
  route-safety guard mechanism — only extend it via the established
  `createGuardedZodios` / raw `_apiClient.axios` patterns.

## Constraints

- Compatibility: must follow the existing `WebTool` / Zodios SDK layering
  exactly (see `searchContent.ts`, `contentExplorationMethods.ts`,
  `restApi.ts`) so the tools are reviewable as idiomatic tableau-mcp code,
  not a bolt-on.
- Performance: a CABU turn can take 30–90s server-side; the SSE read must
  honor `config.maxRequestTimeoutMs` (`MAX_REQUEST_TIMEOUT_MS`, default
  10 min, min 5s) via an `AbortSignal`, not a shorter hardcoded timeout.
- Security/privacy: never route the signed `cabuCtx` cookie value through
  the LLM/tool-call arguments. Per the Phase 0 spike (see Implementation
  notes), the cookie is not needed at all — CES's Redis-backed
  conversation-context store carries continuity server-side, keyed by
  `conversationId` alone — so there is nothing to capture, store, or
  replay anywhere in the CABU tool module. Raw axios calls must still go
  through `createGuardedZodios`'s route-safety guard (confirmed to install
  on `client.axios` directly, so it covers raw `_apiClient.axios.post/get`
  calls too).
- UX/API behavior: tool descriptions must tell the model to source LUIDs via
  `list-datasources`/`search-content` and to thread `nextParentLuid` into
  follow-up `cabu-ask` calls.
- Rollout: new `tableau-agent` tool group, not enabled in any existing
  group list; demo runs with `INCLUDE_TOOLS=...,tableau-agent` explicitly.

## Risk classification

medium

Reason: no CES changes and the tools are purely additive/off-by-default, so
blast radius on existing tableau-mcp users is zero. Risk is concentrated in
correctly replicating an undocumented-outside-source-code protocol (SSE
event shapes, cookie refresh semantics) with no in-repo streaming precedent,
and in the Phase 0 de-risking spike (cookie-dependency behavior, demo-site
access) not yet having been run — see Open questions.

## Test plan

- Unit: vitest, mirroring `searchContent.test.ts`'s
  `vi.hoisted`/`vi.mock('../../../restApiInstance.js', ...)`/
  `getMockRequestHandlerExtra`/`Provider.from(tool.callback)` pattern.
  Covers: SSE record parser (multi-line `data:`, multiple events per read,
  `error` event, missing terminal `complete`, abort/timeout); `cabuMethods`
  request bodies and cookie capture; `cabu-start-conversation` and
  `cabu-ask` tool argument validation, answer assembly, and error mapping;
  `utteranceArgs` base64/JSON round-trip; `parentLuid` threading across two
  simulated turns.
- Integration: none automated (no CABU sandbox in CI); covered by the Phase
  0 throwaway spike script and the Phase 2 manual MCP Inspector run.
- E2E/manual: a recorded 3-turn conversation through Claude Code/Desktop
  against the Phase 0 demo site, per the plan's Phase 2/Verification
  sections.
- Regression: full `npx vitest run --config ./vitest.config.ts` and
  `npm run build` must stay green; new tool group must not appear in any
  default `webToolGroups` consumer unless explicitly included.

## Implementation notes

- DTO shapes (fields, nullability, enums) for all CABU request/response
  bodies were read directly from CES source
  (`war-content-exploration/.../analyticsassistant/api/cabu/*.java`,
  `api/conversations/UtteranceDTO.java`, `api/dashboards/*.java`,
  `react/model/UtteranceType.java`) — see PR description for the full list.
  Notably `CABUUtteranceResponseDTO` is `{utteranceId, b3TraceId}` (not
  `traceId`).
- SSE `response_complete` event payload shape was read directly from
  `ResponseNode.java`/`ResponseFormatter.java`: the server has already
  parsed WAII's response into ready-to-render `datatables`/`charts`/
  `dataDetails` fields capped to marker counts — the tool's job is to
  surface/format these, not reparse WAII internals.
- `src/sdks/tableau/methods/{datasources,views,publishing,workbooks}Methods.ts`
  all use raw `this._apiClient.axios.post/get(...)` (bypassing typed Zodios
  calls) for cases needing raw response headers or non-JSON bodies — this is
  the precedent `cabuMethods.ts` follows for capturing `Set-Cookie` and for
  the streaming GET.
- `axios` (1.17.0, confirmed via `node_modules/axios/package.json`) is
  already a transitive dependency (via `@zodios/core`) and is already
  imported directly elsewhere (`src/utils/axios.ts`); its Node
  `responseType: 'stream'` support is used for the SSE GET instead of raw
  `fetch`, since it is the one HTTP client already wired with the
  route-safety guard and logging interceptors. This is a deliberate,
  reasoned deviation from the plan text's rough suggestion of `fetch`.
- `'tableau:views:embed_authoring'` does not yet exist in either
  `TableauApiScope` (`src/server/oauth/scopes.ts`) or the separate
  `JwtScopes` union (`src/restApiInstance.ts`) — it must be added as new
  code in both places, not just referenced.
- Cookie-state strategy: the Phase 0 spike (two independent sub-conversations
  against the demo site's PDS, each turn using a fresh PAT sign-in to
  simulate tableau-mcp's fresh-HTTP-client-per-tool-call isolation, asking a
  turn-2 question answerable only by carrying turn-1's context forward) found
  that replaying the `cabuCtx` cookie makes no observable difference: the
  no-cookie scenario produced the same correctly-context-dependent answer as
  the cookie-replayed scenario. The demo cell's Redis-backed conversation
  context store carries continuity server-side, keyed by `conversationId`
  alone. The implementation therefore does not capture, store, or replay any
  cookie anywhere — `cabuMethods.ts`'s three CABU calls take no cookie
  parameter, and there is no per-conversation state of any kind in the MCP
  process.

## Open questions / conflicts

- Timeline mismatch: Seb said "cabu MCP for 266", Tara said "GA in
  November", epic says 264.4 — not yet confirmed with Tara.
- Scope: PDS vs. workbook priority, and one-tool-vs-two, are both raised as
  open comments on Seb's doc; this spec uses two tools (start + ask).
- Tool-group gating mechanism (`features.json` vs. `INCLUDE_TOOLS` env var)
  not yet confirmed with Dan Platt / #tab-dev-mcp-contrib; defaulting to the
  existing `webToolGroups` + env-var inclusion mechanism already in the repo.

## Final evidence

Filled in by agent at the end:

- Files changed:
- Checks run:
- Review result:
- Security result:
- Remaining risks:
