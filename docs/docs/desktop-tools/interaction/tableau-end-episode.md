---
sidebar_position: 4
---

# End Episode

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Closes the current authoring/eval episode for a %product_name% session, recording a terminal status and any closing notes. It is the second half of the authoring-episode lifecycle (paired with `tableau-begin-episode`): begin opens an episode for a session, and this tool ends it. The `status` argument states how the episode finished:

- `succeeded` — the episode completed as intended.
- `failed` — the episode ended without achieving its goal.
- `abandoned` — the episode was dropped before completion.

:::note
The authoring-episode lifecycle tools are registered only when episode-event recording is enabled on the MCP server — set [`EPISODE_EVENTS`](../../configuration/mcp-config/env-vars.md#episode_events)`=on`. When it is off, this tool is not advertised to the MCP client.
:::

## APIs called

This tool does not call the %product_name% %ecapi_name%. Ending an episode is bookkeeping the MCP server performs on its own: it resolves the target session, closes the matching in-process episode record, and appends an `episode_end` entry to a local episode log file. Because nothing is sent to the running %product_name% instance, there is no loopback route and no per-session bearer token involved.

- Resolve which %product_name% session to end the episode for. This reads the local instance-discovery files that %product_name% writes; it is not an %ecapi_name% call.
- Close the current episode for that session and record its terminal status. In-process session state plus an append to a local episode log file; no %ecapi_name% call.

## Required arguments

### `status`

The episode's terminal status. One of `succeeded`, `failed`, or `abandoned`.

- `succeeded` — the episode completed as intended.
- `failed` — the episode ended without achieving its goal.
- `abandoned` — the episode was dropped before completion.

#### Example

```json
{ "status": "succeeded" }
```

## Optional arguments

### `session`
The %product_name% session (its instance id, e.g. `77700`) whose episode should be ended. Optional: when omitted, the pinned session is used if one is set; otherwise the tool auto-resolves to the sole running %product_name% instance.

#### Example

`"77700"`

#### Session resolution

If no `session` is given and there is no pinned session, the tool resolves the session automatically only when exactly one %product_name% instance is running. If none are running, or more than one is, it returns an error asking you to name the session explicitly.

:::note
If that resolved session has no open episode, the tool refuses: No active episode for session '77700', with the resolved session id in the quotes.
:::

<hr />

### `notes`

Optional free-text notes recorded with the episode's terminal event — for example a short explanation of why the episode was `failed` or `abandoned`.

#### Example

`"user cancelled before applying the chart"`

## Notes and caveats

- The tool reports an error when the resolved session has no open episode (for example, if `tableau-begin-episode` was never called for it, or the episode was already ended).
- Episode logging is best-effort: if writing the episode log file fails, the failure is swallowed so it never affects the tool's result or product behavior.

## Example result

On success the tool returns text confirming the ended episode's id and its terminal status.

```json
{
  "isError": false,
  "content": [
    {
      "type": "text",
      "text": "Episode ended episode_id=6b1e2f4a-9c31-4d7a-8f2e-1a2b3c4d5e6f status=succeeded"
    }
  ]
}
```

## Related

- [`tableau-begin-episode`](../interaction/tableau-begin-episode.md) — opens the episode that this tool ends
