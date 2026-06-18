---
sidebar_position: 3
---

# Update Cloud Extract Refresh Task

Updates the schedule of an extract refresh task on Tableau Cloud. Use this to change how often a refresh runs (e.g. downgrade Daily → Weekly), shift its time window, or modify the day/hour it executes — without recreating the task.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag to be enabled.
:::

:::info Tableau Cloud Only
This tool calls the **Cloud variant** of the update endpoint and is not appropriate for Tableau Server. The Server variant has a different payload shape and is tracked separately.
:::

## APIs called

- [Update Cloud Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#update_cloud_extract_refresh_task)

## Use cases

Use this tool when you need to:
- Reduce the frequency of an under-used extract refresh (e.g. Hourly → Daily, Daily → Weekly)
- Move a refresh window to off-peak hours
- Change the recurrence intervals (e.g. weekday → weekend)

## Required permissions

- **Tableau Cloud**: Requires `tableau:tasks:write` OAuth scope
- **Site Role**: Must be one of:
  - SiteAdministratorCreator
  - SiteAdministratorExplorer
  - ServerAdministrator

## Configuration

Enable this tool by setting the feature flag:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

| Parameter  | Type   | Required | Description                                                                                       |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------- |
| `taskId`   | string (UUID) | Yes      | The ID of the extract refresh task to update. Obtain from `list-extract-refresh-tasks`.    |
| `schedule` | object | Yes      | The new schedule to apply. Replaces the existing schedule wholesale.                              |

### `schedule` shape

| Field                                | Type     | Required | Description                                                                                              |
| ------------------------------------ | -------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `frequency`                          | enum     | Yes      | One of `Hourly`, `Daily`, `Weekly`, `Monthly`.                                                           |
| `frequencyDetails.start`             | string   | Yes      | Start time in 24-hour `HH:mm:ss` format, e.g. `"06:00:00"`.                                              |
| `frequencyDetails.end`               | string   | Hourly only | End time in 24-hour `HH:mm:ss` format. **Required** for `Hourly` (minute portion must match `start`, must be strictly after `start`). Omit for `Daily`/`Weekly`/`Monthly` — Tableau ignores it. |
| `frequencyDetails.intervals.interval` | array    | No       | Recurrence intervals. Each entry can specify `weekDay` (Sunday..Saturday), `monthDay`, `hours`, or `minutes` depending on the frequency. |

### Schedule constraints

The schema enforces these rules — invalid input is rejected before any Tableau API call:

- **Time format** – `start` and `end` must be zero-padded `HH:mm:ss` (e.g. `"06:00:00"`, not `"6:00:00"`).
- **Minute boundary** – The minute portion of `start` (and `end`, when present) must be on a 5-minute boundary: `00`, `05`, `10`, `15`, `20`, `25`, `30`, `35`, `40`, `45`, `50`, or `55`, with seconds = `00`. `07:26:00` is rejected; `07:25:00` and `07:30:00` are accepted.
- **Hourly** – `start` and `end` must share the same minute portion (e.g. `06:00:00`/`18:00:00` ✓, `06:00:00`/`18:30:00` ✗); `end` must be strictly after `start` (numeric comparison, not lexical).
- **Daily / Weekly / Monthly** – `end` is ignored — omit it.
- **Weekly** requires at least one interval with `weekDay`; **Monthly** requires at least one interval with `monthDay`.

Tableau may still reject a schema-valid request with `409004 Bad Request` (`Invalid subscription schedule`) for site-specific rules. In that case the tool surfaces Tableau's structured error verbatim — e.g. `Tableau 400 [409004]: Bad Request: Invalid subscription schedule. (...)` — so callers can recover without parsing axios errors. A 404 is mapped to a "Tableau Cloud only" hint pointing at `list-extract-refresh-tasks` since the most common cause is calling against a Tableau Server site or with a stale taskId.

## Example: Daily → Weekly Sunday at 06:00

```json
{
  "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "schedule": {
    "frequency": "Weekly",
    "frequencyDetails": {
      "start": "06:00:00",
      "intervals": { "interval": [{ "weekDay": "Sunday" }] }
    }
  }
}
```

## Example: Hourly between 08:00 and 18:00 every 2 hours

```json
{
  "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "schedule": {
    "frequency": "Hourly",
    "frequencyDetails": {
      "start": "08:00:00",
      "end": "18:00:00",
      "intervals": { "interval": [{ "hours": 2 }] }
    }
  }
}
```

## Response

A confirmation message describing the updated task and its new schedule:

```
Extract refresh task 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' has been successfully updated. New schedule: Weekly (start 06:00:00).
```

## Error cases

| Scenario                          | Behavior                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Task ID does not exist            | Returns a 404 error                                                            |
| User is not a site administrator  | Returns an error indicating admin permissions are required                     |
| `ADMIN_TOOLS_ENABLED` not set     | Tool is not registered and unavailable to the client                           |
| Invalid `frequency` value         | Schema-level rejection before any API call                                     |
| Missing `frequencyDetails.start`  | Schema-level rejection before any API call                                     |
| Tableau Server (not Cloud)        | This tool is Cloud-only; calling it against a Server site is not supported     |
