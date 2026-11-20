---
sidebar_position: 8
---

# Get Field Dependencies

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Shows what breaks if a field, calculation or parameter changes, or what it is built from, in the workbook currently open in the connected %product_name% instance. It follows calculation formulas, the fields and filters each worksheet uses, and the worksheets each dashboard shows. This is a read-only operation.

## APIs called

This tool reads the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood the workbook document is fetched from the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. Building and walking the dependency graph is done in process against that document; no other call is made.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the open workbook document. Authorized by the session's loopback bearer token; requires a workbook to be open.
  - `GET /v<x>/workbook/document` — read the open workbook document. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Builds the dependency graph from calculation formulas, worksheet fields and filters, and dashboard zones, then walks it from the requested field. Parsed in-process; not an API call.

## Required arguments

### `field`

Caption or name of a field, calculation or parameter in the open workbook. Type: string. Minimum length: 1 after trim. The match is exact and case-insensitive; outer brackets are ignored. There is no fuzzy matching.

#### Example

`"Member Profit"`

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when it is pinned or exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

<hr />

### `direction`

Which way to walk. Type: `"dependents"` or `"dependencies"`. Default: `"dependents"`.

- `dependents` — what uses this field: calculations whose formulas name it, worksheets that use it, and dashboards that show those worksheets.
- `dependencies` — what this field uses: the fields and parameters its formula names, and theirs in turn.

#### Example

`"dependencies"`

<hr />

### `datasource`

Datasource name or caption to search in. When omitted, every datasource is searched. Use it when the same caption exists in more than one datasource.

#### Example

`"Sample - Superstore"`

## Notes and caveats

- **Live workbook only.** The tool reads the open workbook document. It does not read cache files or published Tableau Cloud or Server content.
- **More than one match.** When the name matches fields in more than one datasource, every match is traced and `ambiguous` is `true`. At most 5 matches are traced; the summary says how many more match, and `datasource` narrows it.
- **Depth is the shortest path.** A node reached two ways reports the shorter one.
- **Cycles end.** A formula cycle, including a calculation that names itself, is listed under `cycles` instead of looping.
- **Unresolved references.** A formula that names a field the workbook does not declare still shows that field, marked `unresolved: true`.
- **Worksheet use means a field on the sheet.** A worksheet uses a field when the field is on a shelf, on the Marks card, or in a filter, in a top-N or other group-filter setting, or in a sort. Calculations declared only inside a worksheet are followed like any other calculation and are marked with that `worksheet`. Fields a sheet only declares as inputs to a calculation are reached through that calculation.
- **Parts the tool cannot read are listed, never dropped.** If a worksheet names something the tool cannot resolve to a known field, or has something it cannot follow, such as a reference line, a group declared inside the sheet, or a filter on an unparsable field, the sheet is added to `notCovered` with the reason and the `summary` says so (for example, "no worksheets found" plus "N sheets have parts this tool can't read"). Treat a zero count as unproven when that note is present.
- **One note for unreadable parts.** The summary names an unreadable sheet only when a traced field reaches it; other sheets are counted. The full list stays in `notCovered`.
- **Groups, sets and text.** A bin group follows its source field. A set follows every field its filter names. A parameter or field named in a sheet's title, caption or tooltip counts as used by that sheet (`text`), and a parameter a sheet declares counts as `declared`. The same holds for dashboard titles and text zones (`text`); a parameter-control zone counts as a use of that parameter by the dashboard (`control`), a filter card as a use of its field (`filter`), a color, size or shape legend as a use of its field (`legend`), a highlighter as `highlight`, and a page-control zone as `pages`. A zone of any other type that names a field is still counted as a dashboard use (`other`) and is listed in `notCovered` as one this tool does not classify. A physical field a sheet declares that its datasource does not list is still found.
- **Not covered.** Every result lists what the graph does not follow in `notCovered`: dashboard actions; groups or sets declared inside a worksheet, and set actions; story points; reference lines and table calculation addressing; datasource filters and extracts; published datasource internals; anything outside the workbook XML.

## Example result

```json
{
  "field": "Region",
  "direction": "dependents",
  "ambiguous": false,
  "summary": "Changing Region (Sample - Superstore) affects no fields, 1 worksheet and 1 dashboard.",
  "roots": [
    {
      "root": {
        "id": "Sample - Superstore\u0000Region",
        "kind": "field",
        "name": "Region",
        "datasource": "Sample - Superstore"
      },
      "nodes": [
        {
          "id": "Sample - Superstore\u0000Region",
          "kind": "field",
          "name": "Region",
          "datasource": "Sample - Superstore",
          "depth": 0
        },
        {
          "id": "worksheet\u0000stage-encore-canon",
          "kind": "worksheet",
          "name": "stage-encore-canon",
          "depth": 1
        },
        {
          "id": "dashboard\u0000Sales by Region",
          "kind": "dashboard",
          "name": "Sales by Region",
          "depth": 2
        }
      ],
      "edges": [
        {
          "from": "worksheet\u0000stage-encore-canon",
          "to": "Sample - Superstore\u0000Region",
          "kind": "uses",
          "locations": [
            "columns",
            "filter",
            "sort"
          ]
        },
        {
          "from": "dashboard\u0000Sales by Region",
          "to": "worksheet\u0000stage-encore-canon",
          "kind": "contains"
        }
      ],
      "cycles": []
    }
  ],
  "notCovered": [
    "dashboard actions",
    "groups or sets declared inside a worksheet, and set actions",
    "story points",
    "reference lines and table calculation addressing",
    "datasource filters and extracts",
    "published datasource internals",
    "anything outside the workbook XML"
  ],
  "nextAction": {
    "label": "Use this trace before changing the field",
    "kind": "prefill"
  }
}
```

The example is the unedited output for `Region` on the real Superstore test workbook. The structured result carries the whole body plus `nextAction`; the text block carries the same body without `nextAction`.

## Related

- [`search-workbook-fields`](./search-workbook-fields.md) — find fields by partial text and see their shelf placements.
- [`list-available-fields`](./list-available-fields.md) — list datasource fields available for authoring.
