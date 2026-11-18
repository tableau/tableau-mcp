---
sidebar_position: 5
---

# Get Flow Task

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Retrieves a single scheduled flow run task (the **schedule** for a Tableau Prep flow) by its task id. A flow run task describes when/how often a flow is configured to run — NOT a record of past executions (for run history use `list-flow-runs`).

  Prefer this tool over `list-flow-tasks` when you already have a task id (e.g. from a previous `list-flow-tasks` call): it is a direct, cheap fetch, whereas `list-flow-tasks` has no server-side filtering and must retrieve **every** task on the site before filtering. Use `list-flow-tasks` only when you need to discover/enumerate tasks.

  **Parameters:**
  - `taskId` (required) – The flow run task id (the task `id` from `list-flow-tasks`).

  **Response:** `{ flowTask }` — the task includes `id`, `flow` (`id`, `name`), `schedule` (frequency, nextRunAt, state, timestamps), `priority`, `consecutiveFailedCount`, and `type`.

  **Caller-role visibility:** non-administrators can only access flow run tasks for flows they own; administrators can access any flow run task on the site.

  **Note:** Requires Tableau REST API access scope `tableau:flow_tasks:read`. When this server is restricted to specific projects/tags, this tool cannot verify that a task's flow is in the allowed set (a task carries no project/tag) and will refuse — use `get-flow` (by flow id) to inspect a specific flow under that configuration.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** `FLOW_READ_TOOLS_ENABLED` when explicitly set; otherwise the
  `flow-read-tools` feature flag. See [flow configuration](../../configuration/mcp-config/env-vars.md#flow_read_tools_enabled).

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Retrieves a single scheduled flow run task (the **schedule** for a Tableau Prep flow) by its task id.

## Required arguments

### `taskId`

The taskId argument.

{/* tool-details */}
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
{/* /tool-details */}
