---
sidebar_position: 1
---

# Add Dashboard

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Add a blank dashboard to the open workbook. It becomes the active sheet; get its id from `get-sheets`. There is no argument for the new dashboard's name: the call creates a blank tab, and you can optionally pin where that tab sits. The result is a status message only — it does not return the new dashboard's name or id.

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to add a blank dashboard to the open workbook. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The request carries no body.
  - `POST /v<x>/workbook/dashboards:new` — add a blank dashboard to the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/addDashboard)

## Optional arguments

### `index`
0-based tab position for the new dashboard. Type: integer. Range: 0 and above. Omit to append the dashboard at the end of the sheet tabs. When supplied, it is sent as the `index` query parameter on the create request; a bare append carries neither a body nor a query.

#### Example

```json
{ "index": 2 }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **Repeating the call adds another dashboard.** The tool is not idempotent: each successful call creates a new blank dashboard.
- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the change has settled, the result says a new dashboard was requested and is still being applied instead of claiming it completed.

## Example results

### Dashboard added

```json
{ "message": "Added a blank dashboard." }
```

### Accepted, still being applied

```json
{ "message": "Requested a new dashboard; Desktop is still applying it." }
```

## Related

- `get-sheets` — lists the names of every dashboard in the open workbook, including one this tool just added
- [`apply-dashboard`](./apply-dashboard.md) — replaces an existing dashboard's layout; it does not create a dashboard
