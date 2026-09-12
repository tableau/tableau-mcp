---
sidebar_position: 8
---

# Get Flow Task

Retrieves a **single** scheduled flow run task (the schedule for a Tableau Prep flow) by its task id.
A flow run task describes when/how often a flow is configured to run — **not** a record of past
executions (for run history use [List Flow Runs](list-flow-runs.md)).

Prefer this over [List Flow Tasks](list-flow-tasks.md) when you already have a task id: it is a
direct, cheap fetch, whereas `list-flow-tasks` has **no server-side filtering** and must retrieve
every task on the site before filtering. Use `list-flow-tasks` only to discover/enumerate tasks.

## APIs called

- [Get Flow Run Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_task)

## Required Tableau API scopes

- `tableau:flow_tasks:read`
- `tableau:mcp_site_settings:read`

This is a read-only tool and is **not** gated by `FLOW_WRITE_TOOLS_ENABLED`.

## Required arguments

### `taskId`

The flow run task id (the task `id` returned by [List Flow Tasks](list-flow-tasks.md)).

## Caller-role visibility

- **Non-admin callers** — can only access flow run tasks for flows they own.
- **Admin callers** — can access any flow run task on the site.

## Bounded context (fail-closed)

A flow run task carries no project or tag and is addressed only by task id, so when the server is
restricted to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the
task's flow is in the allowed set and **refuses** (mirroring [List Flow Tasks](list-flow-tasks.md)).
Use [Get Flow](get-flow.md) by flow id to inspect a specific flow under that configuration.

## Response

An object `{ flowTask }` — `id`, `flow` (`id`, `name`), `schedule` (frequency, nextRunAt, state,
timestamps), `priority`, `consecutiveFailedCount`, and `type`.
