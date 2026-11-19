---
sidebar_position: 9
---

# Apply Worksheets and Compose Dashboard

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies a queue of prepared worksheets to the workbook open in %product_name% and then composes them into a dashboard, in one ordered pass (apply, then compose). Each queued worksheet is applied in the order you list it; the dashboard is composed last, from those worksheets plus any worksheets already in the workbook that you name. Optional `kpiWorksheetNames` supplies an ordered KPI strip. If a dashboard of that name already exists, the compose is refused unless you pass `replaceExisting: true`. The whole queue is checked against live state before the first write, and the pass stops at the first step that fails, reporting a per-step receipt of what landed.

:::warning[Destructive]
This tool is not read-only and not idempotent. It writes worksheets and a dashboard into the live %product_name% session. Passing `replaceExisting: true` deletes and rebuilds an existing dashboard that shares the name you pass.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. Every write in the batch — each worksheet and the dashboard — is a whole-workbook document apply, and each is preceded by a read and followed by a verifying read.

- Reads the open workbook document. A single read up front checks the queue against live state; further reads guard each apply against a workbook that changed underneath it and verify each apply afterwards.
  - `GET /v<x>/workbook/document` — retrieve the open workbook document. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Applies each queued worksheet in order, then the composed dashboard. Replacing an existing dashboard of the same name (`replaceExisting: true`) costs two applies (one to remove it, one to add its replacement).
  - `POST /v<x>/workbook/document` — replace the open workbook from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Focuses the sheet each apply produced — the worksheet after a worksheet apply, the dashboard after the compose. This step is best-effort; a failure here does not fail the step that already landed.
  - `POST /v<x>/workbook:goToSheet` — activate the sheet the apply produced. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/goToSheet)
- Claims each queued worksheet and checks it before any write: the worksheet content is validated, its name is checked for collisions, and it is confirmed to belong to this session and this %product_name% instance. All in-process; no API call.

## Required arguments

### `dashboardName`

Name of the dashboard to compose once the queued worksheets are applied, 1–255 characters. If a dashboard of this name already exists, the compose is refused unless `replaceExisting` is `true`.

The name must be unique among sheets: it is rejected before any write if it matches a worksheet already in the workbook or the title of a worksheet in the queue.

#### Example

```json
{ "dashboardName": "Executive Overview" }
```

## Optional arguments

### `session`
Identifier of the target %product_name% session, up to 64 characters. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

<hr />

### `artifactIds`

Identifiers of prepared worksheets to apply before the dashboard is composed, in the order given. Up to 6 identifiers, each 1–255 characters. These are the identifiers returned when worksheets are built from templates; omit the argument to compose a dashboard purely from worksheets that are already in the workbook.

The worksheet each identifier carries is named by the prepared worksheet itself — you do not name them here, and their names are appended after the names you pass in `existingWorksheetNames`.

#### Preparation is single-use and session-bound

A prepared worksheet can be applied once. Once a batch dispatches it, the identifier is consumed and a later call naming it fails. The same applies to an identifier that was never built, that another call is currently applying, or that belongs to a different session or a different %product_name% instance. Duplicate identifiers in one call are rejected outright.

All of these are caught in preflight, before any write, so the batch fails with nothing applied and is safe to retry once you build fresh worksheets.

#### Staleness check

Each prepared worksheet records the state of the workbook it was built against. If the workbook changed in a way that invalidates it, the batch stops in preflight rather than applying content built for a workbook that no longer exists.

#### Example

```json
{ "artifactIds": ["artifact-1", "artifact-2"] }
```

<hr />

### `existingWorksheetNames`
Names of worksheets already in the open workbook to include on the dashboard, up to 6, each 1–255 characters. They are placed ahead of the worksheets that come from `artifactIds`.

Each name must match a worksheet that is present in the workbook and rendered — that is, one that has its own sheet tab. Names that do not resolve are reported before any write, and the message names them.

#### Example

```json
{ "existingWorksheetNames": ["Sales by Region"] }
```

<hr />

### `kpiWorksheetNames`
Ordered KPI worksheet names to show in a KPI strip, 1–5 names, each 1–255 characters. Optional. Used with the `executive-summary` layout.

#### Example

```json
{ "kpiWorksheetNames": ["Sales KPI", "Profit KPI"] }
```

:::note
kpiWorksheetNames requires layoutType "executive-summary". Duplicate KPI worksheet name(s) are refused, and the message names each repeated name. Unknown KPI worksheet name(s) are refused when a name is not one of the worksheets being placed on the dashboard, and the message names each unknown name.
:::

<hr />

### `title`

Title text rendered as a bold header band across the top of the dashboard, above the worksheets. 1–255 characters. When omitted, no title band is added.

#### Example

`"Executive Overview"`

:::note
Dashboard "the dashboard name" readback did not match the requested title and layout. The check runs after the dashboard is posted, and the batch reports `applied: "unknown"` with `retrySafe: false`. The message names the dashboard.
:::

<hr />

### `layoutType`
How the worksheets are arranged on the dashboard. One of `auto-grid`, `rows`, `columns`, or `executive-summary`. Defaults to `auto-grid`.

- `auto-grid` (default) — worksheets flow left-to-right, top-to-bottom across `gridColumns` columns.
- `rows` — worksheets stack vertically, each spanning the full width.
- `columns` — worksheets sit side by side, each spanning the full height.
- `executive-summary` — executive layout; pair with `kpiWorksheetNames` for the ordered KPI strip.

#### Example

`"columns"`

:::note
layoutType "executive-summary" requires at least one KPI worksheet name. layoutType "executive-summary" requires at least one non-KPI worksheet.
:::

<hr />

### `gridColumns`

Column count used by the `auto-grid` layout. Range: 1-6. When omitted, the grid uses the smaller of 2 and the number of worksheets.

#### Example

`2`

:::note
gridColumns cannot be combined with layoutType "executive-summary".
:::

<hr />

### `replaceExisting`

Whether to delete and rebuild a dashboard that already has this `dashboardName`. Defaults to `false`: if that dashboard already exists, the compose is refused in preflight and nothing is applied. Pass `true` only for an explicit request to rebuild or replace that dashboard.

:::note
`replaceExisting` does not override a name collision with a worksheet. A dashboard name that matches a worksheet already in the workbook, or a worksheet in the queue, is still rejected before any write.
:::

#### Example

```json
{ "replaceExisting": true }
```

## Notes and caveats

- **Combined worksheet budget.** The prepared worksheets and the named existing worksheets together must total between 1 and 6. A queue outside that range, or one whose worksheet names collide with each other, fails in preflight with nothing applied.
- Duplicate worksheet name(s) are refused in preflight, and the message names each repeated name. Nothing is applied.
- **Preflight is all-or-nothing; the writes are not.** Everything checkable is checked before the first write, so a rejected queue leaves the workbook untouched and is safe to retry. Once writing starts, the batch stops at the first failure: the steps that already landed stay landed, the rest are reported as skipped, and the overall `applied` is `"partial"`.
- **An uncertain step ends the batch.** If a worksheet apply cannot be confirmed — the request may have reached %product_name%, or its verification did not pass — the batch reports `applied: "unknown"` with `retrySafe: false` and does not start the next step. Inspect the live workbook before retrying rather than re-running the call.
- **Receipts are bounded.** Error text and verification messages in the receipt are truncated at 384 characters, so a long failure message from %product_name% is reported in abbreviated form.

## Example results

### Whole batch applied

```json
{
  "applied": true,
  "retrySafe": false,
  "steps": [
    {
      "index": 0,
      "operation": "worksheet",
      "artifactId": "artifact-1",
      "state": "applied",
      "retrySafe": false,
      "title": "Profit Trend",
      "verification": { "ok": true, "status": "passed" }
    },
    {
      "index": 1,
      "operation": "dashboard",
      "dashboardName": "Executive Overview",
      "state": "applied",
      "retrySafe": false,
      "worksheets": ["Sales by Region", "Profit Trend"],
      "replaced": false,
      "verification": { "status": "passed", "issues": [] }
    }
  ]
}
```

### Stopped after a later worksheet failed

```json
{
  "applied": "partial",
  "retrySafe": false,
  "steps": [
    {
      "index": 0,
      "operation": "worksheet",
      "artifactId": "artifact-1",
      "state": "applied",
      "retrySafe": false,
      "title": "Profit Trend",
      "verification": { "ok": true, "status": "passed" }
    },
    {
      "index": 1,
      "operation": "worksheet",
      "artifactId": "artifact-2",
      "state": "failed",
      "retrySafe": true,
      "error": "Template artifact \"artifact-2\" was already consumed. Build a fresh artifact."
    },
    {
      "index": 2,
      "operation": "dashboard",
      "dashboardName": "Executive Overview",
      "state": "skipped",
      "retrySafe": true,
      "reason": "stopped after task 1 failed"
    }
  ]
}
```

## Related

- [`apply-worksheet`](../worksheet/apply-worksheet.md) — applies a single prepared worksheet.
