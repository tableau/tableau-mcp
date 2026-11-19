---
sidebar_position: 3
---

# Begin Episode

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Begins a new authoring/eval episode for a `%product_name%` session and returns a generated `episode_id` that groups the telemetry recorded until the episode ends. The episode is tracked in the MCP server's in-process, per-session state, and — when episode-event recording is enabled — an `episode_begin` event is appended to the server's local episode-events log. If an episode is already open for the resolved session, it is automatically closed (with status `abandoned`) before the new one begins.

:::note[Availability]
The begin- and end-episode tools are registered only when episode-event recording is enabled on the MCP server — set [`EPISODE_EVENTS`](../../configuration/mcp-config/env-vars.md#episode_events)`=on`. When it is off, neither tool is available.
:::

## APIs called

This tool does **not** call the `%product_name%` `%ecapi_name%`, and it does not contact the Tableau Cloud or Server REST API — so it issues no route and involves no OAuth scopes. It works from the MCP server's in-process session state plus, when episode-event recording is enabled, the server's local episode-events log file.

- Records the new episode in the MCP server's in-process, per-session episode state and returns its generated `episode_id`. In-process session state; no API call.
  - If an episode is already open for the resolved session, that episode is first closed with status `abandoned` before the new one is recorded. In-process; no API call.
- When episode-event recording is enabled, appends an `episode_begin` event to the server's local episode-events log. Local filesystem; no `%ecapi_name%` call. The log is written to [`EPISODE_EVENTS_DIR`](../../configuration/mcp-config/env-vars.md#episode_events_dir), which defaults to [`FILE_LOGGER_DIRECTORY`](../../configuration/mcp-config/env-vars.md#file_logger_directory).
- Resolves which `%product_name%` session the episode belongs to. When `session` is omitted, this reads the local instance-discovery files written by `%product_name%` to find the running instance. Local filesystem; no `%ecapi_name%` call.

## Optional arguments

### `session`
Session ID identifying which `%product_name%` instance the episode belongs to (for example, `77700`). When omitted, the server targets the session pinned at launch, or — if none is pinned — the single running `%product_name%` instance. If several instances are running and no `session` is given, the call is rejected and asks you to name one.

#### Example

```json
{ "session": "77700" }
```

<hr />

### `intent`

Optional free-text label describing the goal of the episode — for example, the user request that started it. When provided, it is recorded on the `episode_begin` event to make the episode easier to identify later. Omit it to begin an episode with no intent label.

#### Example

`"chart request"`

## Notes and caveats

- Episode recording is best-effort telemetry and never affects the tool's result: if the server cannot write the episode-events log, the episode still begins and the `episode_id` is still returned.

## Example result

On success the tool returns a text message containing the new episode's `episode_id`:

```text
Episode begun episode_id=1f2e3d4c-5b6a-7089-9abc-def012345678
```

## Related

- [`tableau-end-episode`](tableau-end-episode.md) — ends the current episode for a session and records its terminal status.
