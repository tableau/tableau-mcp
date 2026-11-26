---
sidebar_position: 9
---

# Signed Confirmation Tokens

How the server gates content-mutating tools behind a preview → confirm step, and how to add a new
mutation tool that uses it.

Tools that change Tableau content run in two phases. A **preview** (`confirm` omitted or `false`)
describes the change, changes nothing, and returns a `confirmationToken`. A **confirm**
(`confirm: true` + `confirmationToken`) applies the change only if that token verifies. The token is
an HMAC-signed, short-lived value bound to the exact change that was previewed. Any server replica
holding the same secret can verify it.

## Problem

The token used to be a random nonce held in an in-memory, per-process registry. That works for one
process, but fails in a multi-replica deployment behind a load balancer (and after any restart): the
preview lands on replica A, the confirm on replica B, and B has never seen the nonce, so every
cross-replica confirm was rejected with "could not verify that a preview ran".

The signed token removes the need for shared state. The preview mints a self-verifying token and
stores nothing; the confirm recomputes the MAC from server-side facts and checks it.

## Token format

Five dot-separated fields, about 100 characters, safe to paste into a tool argument:

```
v1.<expiresAtMs>.<tokenId>.<preState>.<mac>
```

| Field         | Content                                                          | Purpose                                        |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `v1`          | Literal version                                                  | Lets the format change later without ambiguity |
| `expiresAtMs` | Decimal epoch milliseconds                                       | Expiry, from `MUTATION_PREVIEW_TTL_MINUTES`    |
| `tokenId`     | 16 random bytes, base64url (22 chars)                            | Makes each preview distinct; replay-cache key  |
| `preState`    | First 8 bytes of a keyed HMAC of the target's state (11 chars)   | Detects "the target changed since the preview" |
| `mac`         | HMAC-SHA256, base64url (43 chars)                                | Integrity and binding                          |

All base64url fields must be the canonical unpadded encoding of the exact byte length, and the whole
token is capped at 256 characters. Nothing in the token is secret: it carries no ids, names, or
roles in clear text.

`preState` is `HMAC-SHA256(key, 'tableau-mcp/pre-state/v1\0' + state)` truncated to 8 bytes, using
the same purpose key as the MAC. It is keyed rather than a plain hash because many states have few
possible values (an `update-user` site role is one of 7): with an unkeyed hash, anyone holding a
token could recover the state by hashing each candidate. Keyed, the field reveals nothing without
the server secret. The label prefix separates it from the MAC input.

### MAC input

The MAC is computed over a JSON array, so a delimiter inside one field can never shift into the
next:

```ts
JSON.stringify(['v1', siteId, userLuid, tool, targetId, binding, preState, expiresAtMs, tokenId]);
```

- `siteId` and `userLuid` come from the authenticated request, never from the token. A token
  presented by a different user or on a different site fails the MAC. A preview without a site or
  user identity fails closed: no token is minted and the tool returns a typed
  `ConfirmationIdentityMissingError` (`confirmation-identity-missing`). Through `guardMutation` it
  is also audited as `denied` with that `denyReason`.
- `tool` is the tool name (or a fixed namespace for MCP Apps approvals, see below).
- `binding` is a fingerprint of the caller-controlled parameters (for example `userId:siteRole` for
  `update-user`, a schedule hash for `update-cloud-extract-refresh-task`). A token previewed for one
  set of parameters cannot confirm another.
- `preState` is recomputed from **live** state on confirm; the value in the token is only compared,
  never trusted.

### Keys

The signing key is derived with HKDF-SHA256 (empty salt, 32-byte output) from
`MUTATION_TOKEN_SECRET`. Each purpose gets its own `info` string, so a token minted for one purpose
never verifies for the other:

| Purpose        | HKDF `info`                        | Used for                                  |
| -------------- | ---------------------------------- | ----------------------------------------- |
| `confirmation` | `tableau-mcp/hitl-confirmation/v1` | The model-visible `confirmationToken`     |
| `app-approval` | `tableau-mcp/hitl-app-approval/v1` | The MCP Apps confirm-panel approval token |

With no secret set, the process generates one random key per purpose at startup. Tokens then verify
only on the process that issued them, which matches the old behavior: fine for stdio or a single
server, fail-closed across replicas.

### Verify order

Checks run cheapest first; every failure rejects:

1. **Malformed**: wrong field count, version, lengths, or encoding.
2. **Expired**: `now >= expiresAtMs`.
3. **Bad MAC**: recompute over the token's **own** `preState` with the current key, then the
   previous key (if set), compared with `timingSafeEqual`.
4. **State changed**: only for an authentic token, compare the token's `preState` with the keyed
   pre-state of the live state, computed with the **same key that verified the MAC** (the current
   key, or the previous key for a token minted before a rotation).
5. **Replayed**: the per-process replay cache already holds `tokenId`. Otherwise it is added, with
   the token's remaining lifetime. Check and add are synchronous, so two concurrent confirms of one
   token on the same process cannot both pass.

Checking the MAC before the state means a forged or tampered token always reports `bad-mac`. The
confirm endpoint can therefore never be used as an oracle for "does the target's current state hash
to X". Only the state-changed case returns an explanation to the caller ("The target changed after
the preview... run the preview again"); every other rejection is the generic "run the preview first"
message.

If a target-state precondition rejects a confirm **after** verify (nothing was mutated), the guard
calls `release()` to remove the replay-cache entry, so the same token can be retried once the
precondition holds.

The same release applies when the confirm's Tableau call fails with a **definite 4xx** (any 4xx
except 408): Tableau rejected the request, so nothing changed and the token may be retried. A 5xx,
timeout, network error, or a failure with no HTTP status may have applied the change, so the token
stays consumed and the user must run a new preview. This is `guardMutation` behavior (tools pass
`httpStatus` to `recordOutcome`); the standalone flow tools have no outcome hook, so a failed flow
confirm always needs a new preview.

## Pre-state binding per tool

| Tool                                      | `binding`                                                    | Pre-state                                                       |
| ----------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `update-user`                             | `userId:siteRole`                                            | The user's current site role (from the guard's own lookup)      |
| `update-cloud-extract-refresh-task`       | Hash of the requested schedule                               | Hash of the task's current schedule (Get Extract Refresh Tasks) |
| `delete-content` (`extract-refresh-task`) | `resourceType:extract-refresh-task`                          | none; deleting the task is the whole change                     |
| `run-flow`                                | Hash of flow id, run mode, output steps, parameter overrides | Set of run ids of the flow's 10 newest runs (status ignored)    |
| `run-flow-task`                           | Task id                                                      | The task's flow id + that flow's 10 newest runs                 |
| `cancel-flow-run`                         | Flow run id                                                  | none                                                            |
| `delete-content` (workbook, data source)  | n/a                                                          | Not token-based: a `pending-deletion` tag on Tableau            |

Pre-state lookups **fail closed**: if the lookup throws (for example a missing read scope under a
scoped OAuth token), the preview mints no token and the confirm mutates nothing. It never degrades
to an empty state.

For the flow tools the run fingerprint is an order-independent set sorted by run id, because Get
Flow Runs returns rows with an empty sort key (new, pending, or in-progress runs) first in an
unstable order. A window of 10 keeps a brand-new run inside the fingerprint in the normal case.
Only run ids are fingerprinted, not status: a run that progresses from Pending to InProgress to
Success between preview and confirm is not a new run and does not reject the confirm. A new run adds
an id and does.

## Configuration

| Variable                         | Required          | Meaning                                                                               |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `MUTATION_TOKEN_SECRET`          | For multi-replica | Signs and verifies. At least 32 characters after trimming. Identical on every replica |
| `MUTATION_TOKEN_SECRET_PREVIOUS` | No                | Verify-only key during rotation. Requires `MUTATION_TOKEN_SECRET`                     |
| `MUTATION_PREVIEW_TTL_MINUTES`   | No (existing)     | Token lifetime. Default 5, range 1 to 30; above 30 is clamped to 30 with a warning    |

- A secret shorter than 32 characters, or `_PREVIOUS` without a current secret, fails at startup.
- Surrounding whitespace (such as the trailing newline of a mounted secret file) is trimmed once,
  when the config is loaded. The token code reads the secret from config only, never directly from
  `process.env`.
- With `DISABLE_SESSION_MANAGEMENT=true` and no secret, the server logs one startup warning that
  confirms will fail across replicas.
- **Rotation:** set the new value as `MUTATION_TOKEN_SECRET` and the old value as
  `MUTATION_TOKEN_SECRET_PREVIOUS` on every replica, wait at least one TTL, then remove `_PREVIOUS`.

See [Environment Variables](../configuration/mcp-config/env-vars.md#mutation_token_secret) for the
user-facing reference.

## Code map

| Module                                         | Role                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/tools/web/_lib/confirmationTokenCodec.ts` | Pure signing code: HKDF key derivation, `mint`, `verify`. No tool imports; keys injected      |
| `src/tools/web/_lib/signedTokenEvidence.ts`    | `SignedTokenEvidence` (an `EvidenceStrategy`): process keys, replay cache, startup validation |
| `src/tools/web/_lib/signedConfirmation.ts`     | `SignedConfirmation`: the one helper tools use; owns minting, verifying, wording, errors      |
| `src/tools/web/_lib/appApproval.ts`            | MCP Apps approval token: mint on preview, deliver in `_meta`                                  |
| `src/tools/web/flows/flowRunPreState.ts`       | Flow-run fingerprint used as the run tools' pre-state                                         |
| `src/utils/redactSecretArgs.ts`                | Redacts an explicit list of secret argument names before logging                              |
| `src/tools/web/_lib/signedTokenEvidence.mock.ts` | Test helper: maps `MUTATION_TOKEN_SECRET*` env values into mocked `getConfig()` results     |

## The `SignedConfirmation` interface

A tool declares **what** it confirms; the helper owns **how**:

```ts
new SignedConfirmation({
  tool: 'my-tool', // WebToolName, bound into the MAC
  targetId, // the resource being changed
  targetKind: 'flow', // human label used in rejection messages
  binding, // fingerprint of caller-controlled params ('' when none)
  resolveState, // optional: live pre-state, read on preview AND confirm
  text: {
    // the preview "NEXT STEP" wording
    subject: 'present this change',
    approvalClause: 'confirm it. Do NOT apply',
    tail: ' before applying the change).',
  },
});
```

It can be used two ways:

- **Through `guardMutation`** (admin tools with an admin gate and audit record): pass
  `confirmation.evidence` as the guard's `evidence`, and return the pre-state from `resolveTarget()`
  as `state`. The guard establishes or verifies the token, raises `PreviewNotRunError`, and audits.
  After a preview, append `confirmation.nextStep()` to the text.
- **Standalone** (tools without the guard, such as the flow tools): call
  `await confirmation.preview(caller)` to get the NEXT STEP text, and
  `await confirmation.confirm(caller, confirmationToken)` before mutating. `confirm` throws
  `PreviewNotRunError` on any failure. A missing or malformed token is rejected before
  `resolveState()` runs, so no REST lookup is spent on a confirm that cannot pass.

### Recipe: adding a new mutation tool

1. Add `confirm` (boolean, optional) and `confirmationToken` (string, optional) to `paramsSchema`,
   both `.describe()`d. Describe the token as "short-lived and bound to this change", never as
   single-use.
2. Pick the `binding`: every caller-controlled parameter that changes **what** the mutation does
   must feed it. Hash structured values instead of embedding them raw.
3. Pick the pre-state: a cheap read of the target that the mutation itself changes (a role, a
   schedule, a run list). If no such read exists, document why replay is harmless (target deleted,
   already in the end state). Make the lookup throw on failure; never return `''` as a fallback.
4. Add every REST scope the pre-state read needs to the tool's `api` set in
   `src/server/oauth/scopes.ts`, and add a regression test in `scopes.test.ts`.
5. Build a `SignedConfirmation` inside the `useRestApi` callback, and use it via `guardMutation` or
   standalone as above.
6. Unit-test: preview returns a `v1.` token; confirm with it succeeds; confirm with different
   parameters, a changed pre-state, an expired token, or a token from another user is rejected; the
   pre-state lookup failing rejects both phases. Use two `SignedTokenEvidence` instances built from
   one secret with separate replay caches to model two replicas.
7. Update the tool's doc page and `docs/src/data/tool-details/<tool>.md` with the token semantics
   and the new scopes.

## MCP Apps approval flow

When the client can render an MCP Apps confirm panel (`delete-content`,
`update-cloud-extract-refresh-task`), the model-driven `confirm: true` path is closed and the change
is applied only by an app-only confirm tool (`confirm-delete-content`,
`confirm-update-cloud-extract-refresh-task`) that the panel invokes on a human click.

- The preview mints a token with the `app-approval` purpose. Because the preview and confirm tools
  have different names, both bind the **preview** tool's name as a fixed namespace.
- The token is attached to the preview result under a `Symbol` key, which `JSON.stringify` drops, so
  it cannot leak into the model-visible text. The result builder moves it into the
  `CallToolResult._meta` key `tableau-mcp/approvalToken`.
- The iframe reads it with `readAppApprovalToken(result)` and passes it to the confirm tool as
  `approvalToken`. The confirm tool verifies it like any other signed token, on any replica.

## Redaction and audit

- The secret, the derived keys, and tokens are never logged. `redactSecretArgs` replaces the value
  of any argument key in an explicit list (`confirmationToken`, `approvalToken`, `token`, `secret`,
  `password`, `accessToken`, `refreshToken`; any depth, case-insensitive) before the debug log line
  and the MCP logging notification for every tool call. There is no suffix rule: pagination and
  progress tokens such as `pageToken`, `nextPageToken`, and `progressToken` are not secrets and are
  logged as-is. A new secret argument name must be added to the list.
- Audit records are emitted by `guardMutation` as before. The evidence descriptor keeps
  `kind: 'registry-nonce'` (no audit schema change) with a fixed `detail` string, never the token. A
  rejected confirm records `denyReason: 'preview-not-run'` with the state-changed explanation when
  that is the cause. The standalone flow tools have no admin gate and emit no audit record, as
  before.

## Known residual risks

The token is unforgeable and bound to the previewed change, but it is **not strictly single-use
across replicas**. The replay cache is per process.

- **Cross-replica replay while the target is unchanged.** Within the TTL (so the TTL is capped at 30
  minutes; a larger `MUTATION_PREVIEW_TTL_MINUTES` is clamped to 30 with a startup warning), a token that was already
  accepted on replica A can be accepted again on replica B if the target's pre-state still matches.
  This was observed live: a same-value `update-cloud-extract-refresh-task` (schedule set to its
  current value) was replayed and accepted on a different replica. The replay re-applies the
  identical change. A real change moves the pre-state, so its replay is rejected. Tools with no
  pre-state rely on the target being gone or already in its end state (deleted task, cancelled run).
- **Flow runs before the first run appears.** For `run-flow` and `run-flow-task` the first confirm's
  new run changes the fingerprint, so a replay is normally rejected (live-verified). A replay that
  lands on another replica before the new run is visible in Get Flow Runs can still start a second
  run.
- **More than 10 runs with no completion time.** If more than 10 of a flow's runs have an empty
  `completedAt` (many queued or never-completed runs), a new run can fall outside the fingerprint
  window and go undetected; the unstable order can also spuriously reject a confirm (preview again).
- **Replay after a revert.** If the change is applied and then something restores the exact
  previewed state, the token can re-apply the change from another replica within the TTL. It still
  requires the same authenticated user and the same parameters.
- **A new preview does not invalidate an older token.** Older tokens stay valid until they expire.
- **The host must hide `_meta`.** The approval token is kept out of model-visible text, but the MCP
  Apps host is responsible for not putting `_meta` into model context. A host that does weakens the
  approval to the same level as the model-visible confirmation token.
- **Secret leak.** Anyone holding the secret and a valid bearer for an authorized user can skip the
  preview step. This bypasses the confirmation step, not Tableau authorization.
- **New scopes need re-consent.** Pre-state reads add Tableau API scopes: `tableau:flow_runs:read`
  (`run-flow`, `run-flow-task`), `tableau:flow_tasks:read` (`run-flow-task`), and
  `tableau:tasks:read` plus the corrected `tableau:tasks:update`
  (`update-cloud-extract-refresh-task` and its app-only confirm). OAuth access tokens are stateless
  and carry the scopes granted at consent time, so users must re-consent to pick up the new scopes;
  until then the pre-state lookup fails and the tool fails closed.

### Follow-up: strict one-time use

Strict single use across replicas requires shared state. The planned follow-up is a shared consume
store (for example DynamoDB or another key-value backend with conditional writes and TTL): on
confirm, atomically insert `tokenId` and reject if it already exists. The signed token stays as is;
the store only replaces the per-process replay cache.
