---
sidebar_position: 2
---

# Author Action

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Authors an action in the workbook currently open in %product_name%. An action wires a mark interaction on a source worksheet (or, in `url`, `filter`, and `highlight` modes, a source dashboard) to a target elsewhere in the workbook: when the reader interacts with marks on the source, the action fires and updates that target. The new action is added to the workbook and the change is verified before the tool reports success.

The `mode` argument selects which kind of action is authored:

- `parameter` (default) — sets a target parameter from a field on the source worksheet.
- `set` — changes the membership of a target set from the marks selected on the source worksheet.
- `url` — opens a URL, optionally inserting field values from the selected marks.
- `filter` — filters a target worksheet or dashboard by the marks selected on the source.
- `highlight` — highlights related marks on a target worksheet or dashboard.

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes**: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Checks the supplied inputs before doing anything — the caption must be non-empty, the source must match the chosen mode, and the target arguments must match that mode. Validated in-process (not an API call).
- Reads the current workbook XML: to reject a caption that collides with an existing action, to resolve the target set against the workbook's datasources in `set` mode, and to splice the new action into the document.
  - `GET /v<x>/workbook/document` — read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Builds the action for the chosen mode, splices it into the workbook-level actions block, and validates the edited document. Assembled and validated in-process (not an API call).
- Applies the edited workbook document, replacing the open workbook.
  - `POST /v<x>/workbook/document` (`Content-Type: application/xml`) — apply the edited workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Re-reads the workbook XML to confirm the new action landed with its target link intact (the target parameter, the target set, the URL, or, for `filter` and `highlight` actions, the target sheet, fields, source scope, and behavior); if the apply completed but the link is not present, the tool reports a failure rather than success.
  - `GET /v<x>/workbook/document` — read the workbook back to verify the action. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)

## Required arguments

No argument is required for every call. Which values are required depends on `operation` and `mode`.

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

### `operation`

Optional. Default create; edit needs mode. One of `create`, `edit`, or `delete`. `delete` removes the action named by `actionName` (_available November 2026 and later_).

### `actionName`

edit/delete: internal name.

:::note
- actionName is only allowed for edit/delete.
- actionName is required for edit/delete; use the exact internal name returned by author-action.
- actionName " " was not found. Available actions: each action's internal name and caption, or none. The quotation is the name you passed.
:::

### `mode`
Which kind of action to author. One of `parameter`, `set`, `url`, `filter`, or `highlight`. Defaults to `parameter`.

This argument decides which of the target arguments are required and which are refused, so supplying an argument that belongs to another mode fails before anything is applied.

#### `parameter` mode

Authors a parameter-change action. `sourceField` and `targetParameter` are both required; `targetSet` must not be supplied. `setMembership`, `clearSelection`, and `singleSelect` have no effect in this mode.

#### `set` mode

Authors a set-change action. `targetSet` is required and `targetParameter` must not be supplied. `datasource`, `setMembership`, `clearSelection`, and `singleSelect` shape how the set is resolved and updated; `sourceField` has no effect, because the members driving the set come from the marks the reader selects.

#### `url` mode

Authors a URL action. `url` is required; `targetParameter` and `targetSet` must not be supplied. Set `sourceWorksheet`, `sourceDashboard`, or both. `sourceField` has no effect — field values are inserted into the URL with `<[Field Name]>` placeholders.

#### `filter` mode

Authors a filter action. `targetSheet` is required; `targetParameter`, `targetSet`, and `url` must not be supplied. Set `sourceWorksheet`, `sourceDashboard`, or both. Pass `filterFields` to filter on specific fields; `datasource`, `clearSelection`, and `singleSelect` shape the action.

#### `highlight` mode

Authors a highlight action. `targetSheet` is required. Set `sourceWorksheet`, `sourceDashboard`, or both. Pass `highlightFields` or `highlightBy`, not both; omit both to highlight on all fields. Parameter, set, filter, and URL options are refused.

#### Example

`"set"`

:::note
- mode is required for edit; pass the complete replacement definition.
- url is not allowed in filter mode.
- url is required in url mode.
:::

<hr />

### `caption`

The display name (caption) of the new action, as it appears in %product_name%. Must be non-empty.

#### Caption must be unique

The caption must not match that of an action already in the workbook — parameter actions, set actions, and other actions are all checked. A collision is rejected before any change is applied — pick a new caption, or edit the existing action instead.

#### Example

```json
{ "caption": "Set Period" }
```

:::note
- caption is required for create/edit; edit replaces the full definition.
- A blank caption is refused as caption empty.
- caption collision — pick a new caption or edit the existing action.
:::

<hr />

### `sourceWorksheet`

The worksheet whose mark interaction triggers the action. In `parameter` and `set` modes it must be non-empty and name a worksheet in the open workbook. In `url`, `filter` and `highlight` modes it may be empty when `sourceDashboard` supplies the source instead.

:::note
In `parameter` mode the source worksheet must expose `sourceField`. In `set` mode it must show marks whose members belong to the target set's dimension. In `url`, `filter` and `highlight` modes the source can be this worksheet, a dashboard (`sourceDashboard`), or both — do not pass a dashboard name here.
:::

:::note
A dashboard name in `sourceWorksheet` is refused: pass it as `sourceDashboard` and leave `sourceWorksheet` empty (or set `sourceWorksheet` to a worksheet inside that dashboard). A worksheet name in `sourceDashboard` is refused: pass it as `sourceWorksheet` instead.
:::

#### Example

```json
{ "sourceWorksheet": "Profit" }
```

:::note
- The name you passed is a dashboard, not a worksheet. Pass it as sourceDashboard and omit sourceWorksheet (or set sourceWorksheet to a worksheet inside the dashboard) so the action is scoped to the dashboard.
- The name you passed is a worksheet, not a dashboard. Pass it as sourceWorksheet instead.
- edit replaces the full definition: pass sourceWorksheet, or '' for a dashboard-only url, filter, or highlight source.
- filter mode requires a source: set sourceWorksheet, sourceDashboard, or both.
- highlight mode requires a source: set sourceWorksheet, sourceDashboard, or both.
- url mode requires a source: set sourceWorksheet, sourceDashboard, or both.
- sourceWorksheet is required in parameter and set mode (mode defaults to parameter).
- sourceWorksheet " " was not found. Available worksheets: the worksheet names in the workbook, or none. The quotation is the name you passed.
- sourceDashboard " " has no zones but sourceWorksheet " " was passed. The quotations are the dashboard and worksheet names you passed.
- sourceWorksheet " " is not on dashboard " ". Worksheets on that dashboard: the worksheet names, or none. Pass a worksheet that is on the dashboard, or omit sourceDashboard to scope the action to the worksheet. The quotations are the worksheet and dashboard names you passed.
:::

### `sourceField`

The field on the source worksheet whose value drives the target parameter when the action fires.

**Required in `parameter` mode**, where it must be non-empty. An omitted or blank value is refused with `sourceField is required in parameter mode. Available fields: ...`. Has no effect in other modes.

#### Example

```json
{ "sourceField": "[Sample - Superstore].[:Measure Names]" }
```

:::note
sourceField is required in parameter mode. Available fields: each field's friendly name and column name, or none.
:::

<hr />

### `targetParameter`

The parameter the action sets when it fires.

**Required in `parameter` mode**, where it must be non-empty and fully qualified in the form `[Parameters].[Name]`. An unqualified target is rejected, because it can leave %product_name% showing a blocking modal. In `set` mode a non-empty value is refused with a pointer to `targetSet`.

:::note
The target parameter must already exist in the workbook; author it at open time before wiring the action to it.
:::

#### Example

```json
{ "targetParameter": "[Parameters].[Parameter 1]" }
```

:::note
- targetParameter is required in parameter mode. Available parameters: each parameter's caption and fully qualified token, or none — author one first with [`author-parameter`](author-parameter.md), then retry.
- targetParameter " " was not found. Available parameters: each parameter's caption and fully qualified token, or none — author one first with [`author-parameter`](author-parameter.md), then retry. The quotation is the value you passed.
- targetParameter must be fully qualified like [Parameters].[X]; unqualified targets can cause a blocking %product_name% modal. Available parameters: each parameter's caption and fully qualified token, or none — author one first with [`author-parameter`](author-parameter.md), then retry.
- targetParameter is not allowed in set mode; use targetSet.
- targetSet is not allowed in parameter mode; use targetParameter.
- targetParameter/targetSet are not allowed in filter mode; use targetSheet.
- targetParameter/targetSet are not allowed in url mode.
:::

<hr />

### `targetSet`

The set whose membership the action changes when it fires.

**Required in `set` mode.** Give the set's name or caption, with or without brackets; the tool matches it against the sets defined in the open workbook and rewrites it into its fully qualified `[datasource].[set]` form for the action. In `parameter` mode a non-empty value is refused with a pointer to `targetParameter`.

#### How the set is resolved

The value is matched against both the name and the caption of every set in the searched datasources (narrow that search with `datasource`):

- A value that matches nothing is refused with a list of the sets that are available, and nothing is applied
- A value that matches sets in more than one datasource is refused as ambiguous, again listing the matches, so you can disambiguate with `datasource`
- Omitting `targetSet` in `set` mode is refused with the same list of available sets

#### Example

```json
{ "targetSet": "Top N Sub-Category Set" }
```

:::note
- targetSet is required in set mode. Available sets: each set's caption, internal name, and datasource, or none — author one first with [`author-set`](author-set.md), then retry.
:::

<hr />

### `targetSheet`

The worksheet or dashboard the filter or highlight action acts on. Required in `filter` and `highlight` mode.

#### Example

```json
{ "targetSheet": "Sales by Region" }
```

:::note
- targetSheet is required in filter mode.
- targetSheet is required in highlight mode.
- targetSheet " " was not found. Available sheets: the worksheet and dashboard names in the workbook, or none. The quotation is the name you passed.
- highlight mode only accepts highlight fields and a targetSheet; parameter, set, filter, and URL options are not allowed.
:::

### `filterFields`

Field captions for a filter on specific fields. Used in `filter` mode. When omitted, the action filters on all fields.

#### Example

```json
{ "filterFields": ["Region", "Category"] }
```

### `highlightFields`

Field captions to highlight on. Used in `highlight` mode. Omit it to highlight on all fields.

#### Example

```json
{ "highlightFields": ["Category"] }
```

:::note
- highlightFields and highlightBy are mutually exclusive.
- highlightFields must contain nonempty field names; omit it for All Fields.
- highlightFields/highlightBy are only allowed in highlight mode.
- Highlight field " " . Available fields: the field names in the workbook, or none. The quotation is the caption you passed. Nothing matches when the caption was not found. More than one match is ambiguous; pass datasource.
:::

### `highlightBy`

Which fields the highlight action matches on when `highlightFields` is omitted. One of `all-fields` (default) or `dates-and-times`. Used in `highlight` mode; refused together with `highlightFields`.

#### Example

`"dates-and-times"`

### `datasource`

A datasource matched against its internal name or a caption that is unique among datasources. Used in `set` mode to narrow the `targetSet` search (when omitted, every datasource in the open workbook is searched), and in `filter` and `highlight` mode to resolve `filterFields` and `highlightFields`. A value that matches no datasource is refused, and the error lists the candidate datasources so you can correct the name. In `parameter` and `url` mode the value is not used.

:::note
If the caption you pass is shared by more than one datasource, the tool refuses and asks for the internal datasource name instead.
:::

#### Example

`"Sample - Superstore"`

:::note
- Datasource " " was not found. Candidates: the internal names of the datasources other than Parameters, up to five. The quotation is the name you passed.
- Datasource caption " " is ambiguous. Use an internal datasource name: the matching internal names. The quotation is the caption you passed.
- Multiple datasources found; specify datasource. Candidates: the internal names of the datasources other than Parameters.
- No non-Parameters datasource found.
- Filter field " " was not found in datasource the resolved datasource name. Available fields: the field captions in that datasource, or none. The quotation is the field you passed.
- The set you named is ambiguous; specify datasource. Matches: each matching set's caption, internal name, and datasource.
:::

<hr />

### `setMembership`

What the action does to the target set's membership when it fires. One of `assign`, `add`, or `remove`. Defaults to `assign`. Applies only in `set` mode.

- `assign` (default) — the selected marks' members replace the set's contents
- `add` — the selected marks' members are added to the set
- `remove` — the selected marks' members are taken out of the set

#### Example

`"add"`

<hr />

### `clearSelection`

What happens when the reader clears the selection on the source. One of `do-nothing`, `show-all`, or `exclude-all`. Applies in `set` and `filter` mode, where it defaults to `do-nothing`. In `highlight` mode it defaults to `show-all`, and that is the only value accepted.

- `do-nothing` (default) — in `set` mode, the set keeps the members it had. In `filter` mode, the filter stays in place.
- `show-all` — in `set` mode, every member is put into the set. In `filter` mode, the filter is cleared and all values show.
- `exclude-all` — in `set` mode, every member is taken out of the set. In `filter` mode, all values are excluded.

#### Example

`"show-all"`

:::note
highlight mode supports only clearSelection show-all; Desktop always clears highlighting when the selection clears.
:::

<hr />

### `sourceFieldAggregation`

Default attr.

### `onClear`

Default set-value if clearValue set.

:::note
onClear is only allowed in parameter mode.
:::

### `clearValue`

Reset on clear; no datetime.

:::note
- onClear=set-value requires clearValue. Pass an explicit empty string to reset a string parameter to empty.
- onClear=set-value needs a clearValue; a non-string parameter has no empty value to set. Provide a value or use onClear=keep-current.
:::

### `singleSelect`

Whether the action is limited to a single selected mark at a time. Applies in `set` and `filter` mode. When omitted, no single-select setting is written into the action at all and %product_name% applies its own default, so pass this only when you want to pin the behavior explicitly.

#### Example

```json
{ "singleSelect": true }
```

<hr />

### `activation`

When the action fires, based on how the reader interacts with marks on the source. Applies in every mode. One of:

- `on-select` (default) — fires when marks are selected.
- `on-hover` — fires when marks are hovered.
- `on-menu` — fires from the mark's context menu.

Defaults to `on-select`.

#### Example

`"on-hover"`

<hr />

### `url`

The URL the action opens when it fires. Pass it raw and unescaped — the tool escapes it. Use `<[Field Name]>` to insert a field value from the selected marks, for example `https://www.google.com/search?q=<[City]>`.

**Required in `url` mode**, where it must be non-empty. Has no effect in `parameter` or `set` mode.

:::note
The URL must not start with `tsl:` — that prefix classifies the action as a sheet-link filter, not a URL action. Pre-escaped XML entities such as `&lt;` or `&amp;` are refused; pass literal characters instead. An identical URL action (same URL and same source) already in the workbook is also refused.

url must not start with 'tsl:' — that prefix classifies the action as a sheet-link filter, not a URL action. url must be passed unescaped: it contains an XML entity such as `&lt;` or `&amp;`. Use literal characters — for field substitution write `<[Field Name]>`, for example `https://www.google.com/search?q=<[City]>`. An identical URL action (same source, URL, and behavior) already exists.
:::

#### Example

```json
{ "url": "https://www.google.com/search?q=<[Product Name]>" }
```

<hr />

### `sourceDashboard`

The dashboard whose mark interaction triggers the action. Used in `url`, `filter`, and `highlight` mode. May be combined with `sourceWorksheet` to scope the action to a worksheet inside that dashboard, or used alone for a dashboard-wide source.

:::note
Pass a dashboard name here, not a worksheet name. See [`sourceWorksheet`](#sourceworksheet) for the mix-up refusals.
:::

#### Example

```json
{ "sourceDashboard": "Commission Model" }
```

:::note
sourceDashboard " " was not found. Available dashboards: the dashboard names in the workbook, or none. The quotation is the name you passed.
:::

<hr />

### `excludeSourceSheets`

Dashboard worksheets to leave out of a dashboard-only source, so marks on them do not fire the action. Used in `url`, `filter`, and `highlight` mode.

#### Example

```json
{ "excludeSourceSheets": ["Sales", "OTE"] }
```

:::note
- excludeSourceSheets is only allowed in url, filter, or highlight mode.
- excludeSourceSheets is only allowed with a dashboard-only source (set sourceDashboard, omit sourceWorksheet).
- The name you passed is a worksheet, not a dashboard. Source must be a dashboard when there are excluded source sheets.
- The dashboard " " has no worksheet zones, so there are no sheets to exclude. Source must be a dashboard when there are excluded source sheets. The quotation is the dashboard name you passed.
- An excluded sheet is not on dashboard " ". Worksheets on " ": . One missing sheet is described as excluded sheet, and several as excluded sheets. Source must be a dashboard when there are excluded source sheets. The quotations are the dashboard name, and the list is the worksheets on it.
:::

### `excludeTargetSheets`

Dashboard worksheets to leave out of a dashboard target, so the action does not change them. Used in `filter` and `highlight` mode.

#### Example

```json
{ "excludeTargetSheets": ["Sales"] }
```

:::note
- excludeTargetSheets is only allowed in filter or highlight mode.
- The name you passed is a worksheet, not a dashboard. Target must be a dashboard when there are excluded target sheets.
- The dashboard " " has no worksheet zones, so there are no sheets to exclude. Target must be a dashboard when there are excluded target sheets. The quotation is the dashboard name you passed.
- An excluded sheet is not on dashboard " ". Worksheets on " ": . One missing sheet is described as excluded sheet, and several as excluded sheets. Target must be a dashboard when there are excluded target sheets. The quotations are the dashboard name, and the list is the worksheets on it.
:::

### `urlTarget`

Where the URL opens. Used in `url` mode. One of:

- `default-zone-or-browser` (default) — %product_name% chooses the default zone or the browser.
- `browser` — opens in the browser.
- `specific-zone` — opens in the dashboard zone identified by `zoneId`.

Defaults to `default-zone-or-browser`.

:::note
`zoneId` is required when `urlTarget` is `specific-zone`, and refused for any other target.

zoneId is required when urlTarget is specific-zone. zoneId is only allowed when urlTarget is specific-zone.
:::

#### Example

`"browser"`

<hr />

### `zoneId`

The dashboard zone that should open the URL. Used in `url` mode when `urlTarget` is `specific-zone`. Must be a positive integer zone id (`1` or greater); `0` is refused because %product_name% treats zone 0 as "no specific zone."

#### Example

```json
{ "zoneId": "4" }
```

:::note
zoneId must be a positive integer zone id.
:::

<hr />

### `urlEncode`

Whether to URL-encode field values inserted into the URL. Used in `url` mode. When omitted or `false`, no `url-escape` flag is written. Pass `true` only when you want inserted field values encoded.

#### Example

```json
{ "urlEncode": true }
```

<hr />

## Notes and caveats

- **Whole-workbook replace.** The new action is spliced into a workbook-level actions block (created between the datasources and worksheets if the workbook has none yet), and the entire workbook document is re-posted to apply it. The apply replaces the open workbook.
- **Readback-verified apply.** After applying, the tool re-reads the workbook and confirms the action is present with the target link for its mode — the target set in `set` mode, the target parameter in `parameter` mode, the URL in `url` mode, or the target sheet, fields, source scope, and behavior in `filter` and `highlight` mode. If %product_name% accepts the apply but the link does not appear on readback, the tool reports a failure instead of success.
- **Not idempotent.** Each successful call adds a new action with a fresh generated name; re-running with the same caption is rejected by the uniqueness check rather than silently repeated.

:::note
- An identical filter action (same source, target, fields, and behavior) already exists.
- An identical highlight action (same source, target, fields, and behavior) already exists.
- The set you named was not found. Available sets: each set's caption, internal name, and datasource, or none — author one first with [`author-set`](author-set.md), then retry.
:::

## Example results

### Parameter action (`mode: "parameter"`)

```json
{
  "actionName": "[Action1]",
  "caption": "Set Period",
  "mode": "parameter",
  "target": "[Parameters].[Parameter 1]",
  "targetParameter": "[Parameters].[Parameter 1]",
  "hint": "the source sheet must expose the source field; the target parameter must already exist (author it at open time)"
}
```

### Set action (`mode: "set"`)

```json
{
  "actionName": "[Action2]",
  "caption": "Drill Into Sub-Category",
  "mode": "set",
  "target": "[Sample - Superstore].[Top N Sub-Category Set]",
  "targetSet": "[Sample - Superstore].[Top N Sub-Category Set]",
  "hint": "readback verified the qualified target set; the source sheet must expose marks that can drive the action"
}
```

### URL action (`mode: "url"`)

```json
{
  "actionName": "[Action1]",
  "caption": "Open Product Details",
  "mode": "url",
  "target": "https://www.google.com/search?q=<[Product Name]>",
  "url": "https://www.google.com/search?q=<[Product Name]>",
  "hint": "readback verified the <link> URL action; the source sheet/dashboard must expose marks that drive the action, and any <[Field]> references must resolve on the source view"
}
```

## Related

- [`author-set`](author-set.md) — authors the sets that a `set` action can target.
- `get-xml` — reads the open workbook's XML.
- [`apply-workbook`](../workbook/apply-workbook.md) — applies whole-workbook XML edits to the open workbook.

{/* tool-details */}
## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `excludeSheets`

Worksheet names to opt out of a dashboard-scoped URL action, so marks on those sheets do not fire it.

:::note
`excludeSheets` is only allowed with a dashboard-only source: set `sourceDashboard` and leave `sourceWorksheet` empty.
:::

#### Example

```json
{ "excludeSheets": ["Sales", "OTE"] }
```

<hr />
{/* /tool-details */}
