---
sidebar_position: 11
---

# Format Dashboard Zones

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Sets rounded corners on the zones of a dashboard in the workbook open in %product_name%. You give a corner radius in pixels and say which zones it applies to; the tool reads the dashboard, sets that radius on every targeted zone, writes the dashboard back, and re-reads it to confirm the change landed on exactly those zones. `scope` chooses the targets:

- `all` — every zone in the dashboard
- `containers` — only the dashboard's layout containers
- `zone_ids` — only the zones whose ids you list in `zoneIds`

:::note[Not read-only, but idempotent]
The tool changes zone formatting in the live %product_name% session, so it is not a read-only operation. It is not destructive: the corner radius on the targeted zones is the only thing it changes, and re-running with the same arguments is safe — when every targeted zone already carries the requested radius the tool writes nothing at all and reports the same result.
:::

## APIs called

This tool acts on a dashboard in the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. A workbook must be open in the target session. The dashboard is read, edited, and written back, so the whole sequence runs as one read-modify-write; mutating applies are serialized against each other so two of them cannot interleave.

- Checks the argument combination and settles on which %product_name% session to target before anything is read. Validated in-process (not an API call). When either check refuses, no call is made.
- Reads the dashboard inventory of the open workbook so `dashboardName` can be matched to one dashboard. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/dashboards` — list the open workbook's dashboards to resolve the target's id. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
- Reads the matched dashboard's layout to find its zones and whatever corner radius each one already carries. The zones the edit will touch are selected from this layout, and the result is computed against it, so a dashboard the tool cannot make sense of is refused here.
  - `GET /v<x>/workbook/dashboards/{id}/document` — read the resolved dashboard's layout. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/getDashboardDocument)
- Re-reads the dashboard immediately before writing and compares it against the first read, so an edit made in %product_name% in between is not overwritten with stale content.
  - `GET /v<x>/workbook/dashboards/{id}/document` — re-read the layout to detect a change since the first read. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/getDashboardDocument)
- Writes the dashboard back with the corner radius set on the targeted zones. Skipped entirely when the edit would produce the dashboard that was already there.
  - `POST /v<x>/workbook/dashboards/{id}/document` — replace the dashboard from the posted fragment (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/applyDashboardDocument)
- Re-reads the dashboard after the write, repeatedly until the change settles, and confirms that each targeted zone carries the requested radius and that the rest of the layout and its content are unchanged.
  - `GET /v<x>/workbook/dashboards/{id}/document` — read the layout back to verify the applied radius. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/getDashboardDocument)

## Required arguments

### `dashboardName`

Dashboard name or id, as it appears in the open workbook. Type: string. The tool matches against the live dashboard inventory after trimming whitespace: an exact id match wins; otherwise an exact name match. A name that matches more than one dashboard is refused, and the tool asks you to pass an id. A name or id that matches nothing is refused with the dashboards that are available, listed by name and id.

#### Example

```json
{ "dashboardName": "Executive Overview" }
```

<hr />

### `cornerRadius`

Radius in pixels, from 0 to 100. Type: integer. Range: 0-100. The same radius is set on every targeted zone; `0` sets square corners. A zone already at the requested radius is left byte-for-byte alone, so a call in which every target already matches makes no write at all.

:::note[Bounds are re-checked before the read]
A `cornerRadius` that is not a whole number from 0 through 100 is refused before the dashboard is read, with the message `cornerRadius must be an integer from 0 to 100.`
:::

#### Example

`14`

<hr />

### `scope`

Zones to format. One of:

- `all` — every zone in the dashboard
- `containers` — only the dashboard's basic and flow layout containers, that is, the zones that hold other zones rather than the worksheet, text, and other content zones inside them
- `zone_ids` — only the zones whose ids you pass in `zoneIds`

#### Zones the tool refuses to format

Rounding a zone means setting a corner radius on that zone's own formatting, so a targeted zone whose existing formatting the tool cannot amend unambiguously is refused by id rather than guessed at. That happens when the zone is empty and cannot carry formatting of its own, when it already carries more than one block of formatting, when it already carries more than one corner radius, or when its formatting cannot be extended safely. The refusal names the zone id, and nothing is written.

:::note[A scope that selects nothing is refused]
When no zone in the dashboard matches, the tool reports `No dashboard zones matched scope "<scope>".` rather than returning a success with an empty target list.
:::

#### Example

`"containers"`

## Optional arguments

### `zoneIds`

Ids of the specific zones to format, as an array of strings. Type: array of strings. Range: 1-64 ids, each 1-255 characters after trimming. Zone ids come from the dashboard's own layout — read it with `get-xml` to see the id on each zone. This argument pairs with `scope: "zone_ids"` and is meaningless without it.

:::note[Refusals]
Each of these is checked before the dashboard is read, except the last, which is checked against the layout once it has been read. In every case nothing is written.

- `zoneIds is required when scope is "zone_ids".` — `scope` is `zone_ids` but `zoneIds` was omitted or empty
- `zoneIds is only allowed when scope is "zone_ids".` — `zoneIds` was passed with `scope` set to `all` or `containers`
- `zoneIds must not contain duplicates.` — the same id appears more than once
- `Dashboard zone ids were not found: <ids>.` — one or more of the ids is not a zone of the resolved dashboard; the message lists the ones that were not found
:::

#### Example

```json
{ "scope": "zone_ids", "zoneIds": ["2", "4"] }
```

<hr />

### `session`
Session ID of the target %product_name% session; optional if pinned or unique. Type: string. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"studio-1"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **A dashboard the tool cannot read is refused, not partially edited.** Selecting zones requires making sense of the whole dashboard layout, so a layout the tool cannot parse unambiguously — unbalanced tags, a zone with no id, two zones sharing an id, a zone outside the dashboard, more than one dashboard in the document — is refused with a `Malformed dashboard:` message before anything is written.
- **A dashboard that changes mid-edit is refused rather than overwritten.** If the dashboard %product_name% reports on the pre-write re-read differs from the one the edit was computed against, the tool reports that the dashboard changed while rounded corners were being applied and asks you to re-read and retry. Nothing is written, so an edit made in %product_name% in the meantime is never clobbered.
- **Success means the change was read back and matched.** The tool reports success only after re-reading the dashboard and confirming the requested radius on the exact targeted zones with the rest of the layout intact; that is what `verified` in the result records. When %product_name% accepts the write but the targeted zones, the dashboard structure, or its content do not survive the read-back, the tool says so instead of reporting success.
- **Document warnings from %product_name% are treated as a failure.** When %product_name% returns warnings while loading the written dashboard, the tool reports those warning messages rather than a success result.

## Example result

The result names the dashboard the tool resolved, the radius it set, the ids of the zones it set it on, and that the change was read back and matched.

```json
{
  "dashboard": "Executive Overview",
  "cornerRadius": 14,
  "zoneIds": ["2", "4"],
  "verified": true
}
```

## Related

- `get-xml` — reads the dashboard layout, which is where the zone ids for `zoneIds` come from.
- [`apply-dashboard`](apply-dashboard.md) — replaces a whole dashboard layout when the change is more than zone corner radius.
- `get-sheets` — lists dashboard names and ids in the open workbook so you can pass a unique `dashboardName`.
