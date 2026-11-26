## Two-phase confirmation

1. **Preview** (default, with `confirm` omitted or `false`): describes the cancellation request
   without contacting Tableau and returns a short-lived `confirmationToken` bound to this change.
2. **Cancel** (`confirm: true`): requires the token from a matching preview. Present the proposed
   cancellation to the user and get explicit approval before making the confirmed call.

## Requirements

- Requires Tableau REST API version **3.10 or later**
- **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you
  **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow.
- Not idempotent: cancelling a run that has **already completed** fails with Tableau error 403135
  (nothing to cancel), so check [List Flow Runs](./list-flow-runs.md) instead of retrying. It also
  fails if a site administrator has
  **disabled flow-run cancellation** for the site

## Bounded context (fail-closed)

A flow run carries no project or tag and is addressed only by run id, so when the server is restricted
to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the run's flow
is in the allowed set and **refuses** (mirroring [Run Flow Task](./run-flow-task.md)).

## Response

An object `{ mcp: { cancelStatus } }`. Report the cancel as _requested_, then confirm the final state
with [List Flow Runs](./list-flow-runs.md) / [Get Flow](./get-flow.md).
