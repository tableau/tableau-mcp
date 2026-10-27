# Fix MCP-Apps client-capability detection under `DISABLE_SESSION_MANAGEMENT` / multi-instance deployments

## Context

`gate-mcp-apps-registration-by-client-capability.md` (W-24061219, PR #861) added live
client-capability gating for MCP-Apps tool registration, but only makes correct decisions when
the same server instance that processed a client's `initialize` handshake also serves that
client's later `tools/list`/`tools/call` requests.

`src/sessions.ts` stores sessions in a plain in-process object:

```ts
const sessions: { [sessionId: string]: Session } = {};
```

This holds the live `StreamableHTTPServerTransport` itself, keyed by `sessionId`, entirely in
one process's memory. Two consequences:

1. **`DISABLE_SESSION_MANAGEMENT=true` (stateless mode)** — `src/server/express.ts`'s
   `createMcpServer` builds a brand-new `WebMcpServer` on every single HTTP request and tears
   it down on `res.on('close')`. `capabilities` is only populated when the request is itself
   the literal `initialize` request (`isInitializeRequest(req.body) ? req.body.params.capabilities
   : undefined`). Since `initialize`, `tools/list`, and `tools/call` are three separate HTTP
   requests, only the (immediately-discarded) `initialize`-handling server instance ever sees
   real capabilities — the instances that actually serve `tools/list`/`tools/call` always get
   `capabilities = undefined`, so MCP-Apps tools always fall back to plain tools regardless of
   what the client actually supports. This was documented as a known, accepted limitation in
   round 2/3 review of W-24061219 (`docs/docs/configuration/mcp-config/env-vars.md`) rather than
   fixed, since fixing it was out of scope for that PR.

2. **Horizontal scaling, even in the default stateful path** — the in-process `sessions` map
   only exists on the pod/instance that handled a given client's `initialize` request. If a load
   balancer doesn't guarantee sticky routing per session, a later `tools/list`/`tools/call`
   request for that same `sessionId` can land on a *different* instance, whose `sessions` map
   never had that entry — breaking session continuity generally, not just MCP-Apps gating.

## Design

Replace the in-memory `sessions` map with a shared external store (Redis or DynamoDB — pick
based on what's already provisioned/operationally supported for this service; DynamoDB
precedent already exists for feature gates, see the Gater Feature Gates workstream), keyed by
`sessionId`, holding only the metadata needed to reconstruct correct behavior:

```ts
type SessionRecord = {
  clientInfo: ClientInfo;
  capabilities: ClientCapabilitiesWithUiExtension;
  clientId: string | undefined;
};
```

**Do not** try to persist the live `StreamableHTTPServerTransport` itself — an open HTTP
streaming connection is inherently local to the process handling it and can't be
serialized/shared. Instead:

- On `initialize` (no `sessionId`, `isInitializeRequest(req.body)` true): write the
  `SessionRecord` to the shared store keyed by the newly-generated `sessionId`, same as today's
  `createSession` but persisting to the external store instead of the local object.
- On a later request with a `sessionId` header: look up the `SessionRecord` from the shared
  store. If the local process doesn't have a live transport for that `sessionId` (e.g. it never
  saw the `initialize` locally, or its own local transport was evicted/restarted), reconstruct a
  fresh `WebMcpServer({ clientInfo, capabilities, clientId })` using the stored record and
  connect a new transport — `registerTools()` will then correctly gate app-tool vs. plain-tool
  registration using the real, persisted capabilities, regardless of which instance handles the
  request.
- This closes both gaps from Context: capabilities survive across requests/instances (fixing
  stateless-mode gating), and session continuity no longer depends on sticky routing (fixing the
  general multi-instance gap).

**Scope question to resolve during implementation:** whether `DISABLE_SESSION_MANAGEMENT`
should remain a separate mode once a shared store exists (the transport still needs to be
initiated per-request in a stateless deployment, but capabilities would no longer need to be
`undefined` on non-initialize requests — the shared store lookup could apply there too), or
whether this fix is scoped to the stateful path only and stateless mode keeps its documented
limitation. Recommend starting with the stateful/session-map path only (directly fixes the
sticky-routing gap) and revisiting whether to extend the same store lookup into the stateless
branch as a follow-up, to keep this change reviewable.

## Critical files

- `src/sessions.ts` — swap the in-process map for a shared-store-backed implementation
- `src/server/express.ts` — session lookup/creation call sites (~lines 130-165)
- `src/server.web.ts` / `src/server.ts` — no expected changes; `capabilities`/`clientId` are
  already threaded through the constructor from W-24061219
- New: whatever client module wraps the chosen store (Redis client or DynamoDB DAO, mirroring
  the Gater Feature Gates DynamoDB DAO precedent if DynamoDB is chosen)

## Verification

- Unit: extend `src/sessions.test.ts` (or add one if it doesn't exist) to cover create/lookup
  round-tripping through the shared-store abstraction (mock the store client).
- Integration/manual: simulate two "instances" locally (two processes pointed at the same
  store) — `initialize` against instance A, then send `tools/list`/`tools/call` with that
  session ID against instance B; confirm correct app-tool registration on B without ever having
  locally seen the `initialize` request.
- Full suite: `npx vitest run`, `npm run build`.
- This is infra/session-layer, not tool-registration logic — still goes through the standard
  dual-reviewer + synthesis gate per repo convention (touches shared session-handling, not a
  mechanical mirror).

## Status

Not started. Tracked as GUS **W-24064643** (epic: `[TMCP] MCP Apps extension for Chat GPT app
launch Part 2`, team: AX Integrations Essentials), filed as a follow-up to W-24061219 / PR #861.
