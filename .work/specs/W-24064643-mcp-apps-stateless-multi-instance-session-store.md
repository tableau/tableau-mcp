# W-24064643: Fix MCP-Apps client-capability detection under DISABLE_SESSION_MANAGEMENT / multi-instance deployments

## Source

- Ticket: GUS W-24064643 (https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002jW0dUYAS/view)
- Slack:
- Google Docs/Drive:
- Owner: Jaehun Song
- Date: 2026-09-01
- Related PRs/issues: follow-up from W-24061219 / https://github.com/tableau/tableau-mcp/pull/861

## Intent

MCP-Apps client-capability gating (W-24061219) should give correct app-tool-vs-plain-tool
decisions for every client, in every supported deployment topology — not just the
single-instance, sticky-session default. Operators running `DISABLE_SESSION_MANAGEMENT=true`
or a horizontally-scaled fleet without guaranteed sticky routing should get the same correct
behavior as the default single-instance stateful deployment.

## Problem

`src/sessions.ts`'s in-process `{ [sessionId]: Session }` map (holding the live transport) means
the capability decision made at a client's `initialize` request is only visible to later
`tools/list`/`tools/call` requests if they're served by the *same process*:
- In stateless mode (`DISABLE_SESSION_MANAGEMENT=true`), every request — including
  `tools/list`/`tools/call` — spins up a brand-new server with `capabilities = undefined`
  (only the literal `initialize` request body carries that field), so MCP-Apps tools always
  fall back to plain tools, regardless of client support. Currently documented as an accepted
  limitation, not fixed.
- In the default stateful path, a client's follow-up request landing on a different
  instance/pod than the one that handled its `initialize` (no sticky routing guaranteed) won't
  find its session at all — a general session-continuity bug, not specific to MCP-Apps.

## Acceptance criteria

- [ ] Session metadata (`clientInfo`, `capabilities`, `clientId`) is persisted in a shared
      external store (Redis or DynamoDB), not an in-process object, keyed by `sessionId`.
- [ ] A request for an existing `sessionId` landing on an instance that didn't handle that
      session's `initialize` locally can still reconstruct a `WebMcpServer` with the correct
      stored capabilities and register tools correctly.
- [ ] Existing single-instance behavior (today's tests in `src/server.web.test.ts` /
      `src/server/mcpUiCapability.test.ts`) continues to pass unchanged.
- [ ] Scope decision documented: whether this fix extends into the `DISABLE_SESSION_MANAGEMENT`
      branch in the same change, or lands stateful-path-only with stateless mode's limitation
      still documented as-is pending a follow-up.

## Non-goals

- Do not persist or share the live `StreamableHTTPServerTransport` object itself across
  instances — it's inherently a local, in-flight HTTP streaming connection.
- Do not change the client-capability gating *logic* itself (`clientSupportsMcpApps`,
  `isKnownIncompatibleClient` in `src/server.web.ts`) — this is purely about making the
  *inputs* to that logic (capabilities, clientId) reliably available regardless of which
  instance serves a given request.
- Do not require sticky-session load-balancer configuration as the fix — that's the status quo
  being replaced, not the target state.

## Constraints

- Compatibility: default (stateful) behavior for single-instance deployments must not regress.
- Performance: session lookup moves from an in-memory hash lookup to a network call per
  session-bearing request — evaluate latency impact; consider caching within a request's
  lifetime if needed, but do not cache stale capabilities across requests (capabilities don't
  change mid-session, so caching for the life of a session is safe if scoped correctly).
- Security/privacy: session records contain `clientInfo`/`capabilities`/`clientId` — no
  Tableau credentials or tokens; confirm the chosen store's access controls are appropriate for
  this data (likely low sensitivity, but verify against existing DynamoDB feature-gate table
  precedent for the org's baseline expectations).
- UX/API behavior: no observable change for well-behaved clients; the fix is transparent.
- Rollout: needs the chosen store (Redis/DynamoDB) provisioned before this can go live in any
  environment — infra dependency, similar to the Gater Feature Gates DynamoDB rollout.

## Risk classification

medium

Reason: touches shared session-handling infrastructure (not just tool-registration logic),
introduces a new external dependency (Redis/DynamoDB) and its provisioning/ops burden, and has
a scope decision (whether to also fix stateless mode) that affects blast radius.

## Test plan

- Unit: extend/add `src/sessions.test.ts` — round-trip create/lookup through the store
  abstraction (mocked store client), confirm no live transport is ever persisted.
- Integration: simulate two "instances" sharing one store; `initialize` against instance A,
  `tools/list`/`tools/call` with that session ID against instance B; assert correct app-tool
  registration on B.
- E2E/manual: exercise via MCP Inspector against a multi-instance local setup if feasible, or a
  staging deployment once the store is provisioned.
- Regression: `npx vitest run` (full suite), `npm run build`.

## Implementation notes

Full design in `plans/fix-mcp-apps-capability-detection-stateless-multi-instance.md`. Consider
reusing the DynamoDB DAO pattern already established for feature gates (see Gater Feature Gates
workstream in the work brain) if DynamoDB is the chosen store, for consistency with existing
ops tooling.

## Open questions / conflicts

- Redis vs. DynamoDB — depends on what's already provisioned/supported for this service; not
  yet decided.
- Whether to fix `DISABLE_SESSION_MANAGEMENT` mode in the same change or as a further follow-up
  (see Non-goals/scope note above).

## Final evidence

Filled in by agent at the end:

- Files changed:
- Checks run:
- Review result:
- Security result:
- Remaining risks:
