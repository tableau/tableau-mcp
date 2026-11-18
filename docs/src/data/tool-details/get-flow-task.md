## Caller-role visibility

- **Non-admin callers** — can only access flow run tasks for flows they own.
- **Admin callers** — can access any flow run task on the site.

## Bounded context (fail-closed)

A flow run task carries no project or tag and is addressed only by task id, so when the server is
restricted to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the
task's flow is in the allowed set and **refuses** (mirroring [List Flow Tasks](./list-flow-tasks.md)).
Use [Get Flow](./get-flow.md) by flow id to inspect a specific flow under that configuration.

## Response

An object `{ flowTask }` — `id`, `flow` (`id`, `name`), `schedule` (frequency, nextRunAt, state,
timestamps), `priority`, `consecutiveFailedCount`, and `type`.
