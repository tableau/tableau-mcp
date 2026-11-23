## Confirm and audit

This mutation is **two-phase**, gated on a server-generated single-use confirmation token:

1. **Preview** (default — `confirm` omitted or `false`): reports the new schedule that would be
   applied without changing anything, and returns a single-use `confirmationToken`.
2. **Update** (`confirm: true` + `confirmationToken`): applies the schedule update. The server
   verifies and consumes the token first.

The token is server-generated and **bound to the previewed `taskId` and `schedule`**: a token minted
prior preview (no valid token) is rejected server-side. This gate genuinely requires the preview
phase to have run for exactly this change; it cannot be bypassed by computing a value. Present the
change to the user and get explicit approval before confirming.

### MCP-Apps confirm panel (cooperative human-in-the-loop)

When the `mcp-apps` feature flag is enabled, this tool ships with an MCP App and the
preview phase renders an in-iframe **confirm panel** describing the schedule change (new frequency and
schedule change is then applied only when a person clicks **Apply schedule change** in that panel,
(`visibility: ['app']`), passing the task id and the full structured schedule. With the flag on, the
model-driven `confirm: true` path is **closed** — the assistant cannot apply the change on the user's
behalf; the only route is the human gesture. The confirm tool verifies a fresh, single-use human
approval recorded during the preview (within `MUTATION_PREVIEW_TTL_MINUTES`, default 5); a missing or
expired approval rejects the update. When the flag is off the tool behaves exactly as the two-phase
`confirm`/`confirmationToken` flow described above.

:::warning[Cooperative, not server-enforced]
This is **cooperative** human-in-the-loop: it depends on the MCP client honoring `visibility: ['app']`
(hiding the `confirm-*` tool from the model) and rendering the confirm panel. The human approval is
recorded during the model-driven preview phase, so a **non-cooperating** client that ignores the
visibility hint could still drive `preview → confirm-*` back-to-back with no human gesture. This task
tool has **no tag layer** — the app approval is the only gate — so a non-cooperating client has nothing
else to clear (the schedule-bound registry nonce still proves a preview *ran*, but not that a human
approved). Server-enforced HITL (an approval primitive the model cannot forge or reach) is tracked as
follow-up work (W-23125362).
:::

:::note[Authoritative audit]
Every attempt — both the preview and the confirmed update, and both allowed and denied attempts (for
example a non-admin caller) — emits a structured authoritative audit record to the server's durable
the actor identity, the tool, action (`update`), phase, the target id, the confirmation evidence kind
(`registry-nonce` for this tool), and the result. A confirmed update emits an `allowed` record when
authorized, then a terminal `completed` (or `failed`, with `failureDetail`) record reflecting the
REST outcome — so the trail records what actually happened, not just intent. This routing is
centralized in the shared mutation guard so every TMCP mutation tool audits identically.
:::

## Use cases

Use this tool when you need to:
- Reduce the frequency of an under-used extract refresh (e.g. Hourly → Daily, Daily → Weekly)
- Move a refresh window to off-peak hours
- Change the recurrence intervals (e.g. weekday → weekend)

## Configuration

Enable this tool by setting:

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Error cases

| Scenario                          | Behavior                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Task ID does not exist            | Returns a 404 error                                                            |
| User is not a site administrator  | Returns an error indicating admin permissions are required                     |
| `ADMIN_TOOLS_ENABLED` not set     | Tool is not registered and unavailable to the client                           |
| Invalid `frequency` value         | Schema-level rejection before any API call                                     |
| Missing `frequencyDetails.start`  | Schema-level rejection before any API call                                     |
| Tableau Server (not Cloud)        | This tool is Cloud-only; calling it against a Server site is not supported     |
