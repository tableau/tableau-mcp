---
sidebar_position: 3
---

# List Available Fields

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Lists the datasource fields available for authoring from a live or cached workbook open in the local %product_name% instance — useful for field exploration, answering field questions, and non-template authoring. It does not report worksheet placements. It reports dimensions and measures across every datasource in the workbook and, in the default `full` verbosity, includes the fully-qualified field reference (`column_ref`) needed to author calculations and other field-based edits; `slim` returns insight candidates. This tool is available at any time and is not needed before binding a template.

A `slim` listing can be narrowed further to the workbook's published datasources: `hasLuid` keeps only the datasources %product_name% reports a LUID for, and `luids` picks out specific ones by LUID. Both are `slim`-only and both need a live %product_name% session.

:::note[Not read-only]
Although this tool only lists fields, it is not marked read-only. When called with a `session` and a `workbookFile`, it re-snapshots the live workbook and rewrites that cache file (plus a small companion file recording which %product_name% session produced it) before listing.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` (where `<x>` is the latest API version). These calls carry no OAuth scopes; each is authorized by that %product_name% session's per-session bearer token over the loopback interface. Which calls are made depends on the arguments: a live read when a `session` is given (or when no cache file is passed), a refresh-then-read when both a `session` and a `workbookFile` are given, and a pure local-file read when only a `workbookFile` is given. A `slim` listing that sets `hasLuid` adds one further live read, of the workbook's datasource inventory.

- Reads the open workbook's XML from the running %product_name% session — when a `session` is provided, or when no `workbookFile` is passed.
  - `GET /v<x>/workbook/document` — read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- When both a `session` and a `workbookFile` are given, re-snapshots the live workbook and rewrites the cache file before listing, so a datasource connected after the cache was written is not missed. A refresh failure is reported as an error rather than silently listing stale fields.
  - `GET /v<x>/workbook/document` — re-read the live workbook to refresh the cache. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - Local filesystem; no API call — rewrites the cache file and its session companion file.
- When only a `workbookFile` is given (no `session`), reads that cache file as-is.
  - Local filesystem; no API call.
- When `hasLuid` is set on a `slim` listing, reads the open workbook's datasource inventory from the running %product_name% session, so each field group can be matched to the LUID of the published datasource behind it.
  - `GET /v<x>/workbook/datasources` — list the datasources the open workbook connects to, with the LUID of each published one. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/listWorkbookDatasources)
- Parses the workbook XML into the dimension/measure field list. Parsed in-process; not an API call.

## Optional arguments

### `session`

Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected). When provided, fields are read from the live session workbook; if a `workbookFile` is also given, that cache file is refreshed from the live workbook first.

#### Example

`"studio-1"`

#### Refreshing a cache file

When a `session` and a `workbookFile` are both supplied, the tool re-snapshots the live workbook, overwrites the cache file and its session companion file, and lists fields from the fresh XML. This closes the gap where a datasource connected after the cache was first written would otherwise be invisible to a cache-only read.

:::note[No stale fallback]
If the live re-snapshot fails, the tool returns an error — it never silently falls back to the stale cache. Retry without `session` to read the existing cache file as-is.
:::

:::note
LUID filtering requires a live %product_name% session.
:::

<hr />

### `workbookFile`

Absolute path to a cached workbook XML file on the local filesystem. Behavior depends on whether a `session` is also given: with a `session`, the file is refreshed from the live workbook before listing; without a `session`, the file is read exactly as-is. Omit `workbookFile` to read fields from the live session workbook. The file must already exist — the tool returns an error if the path is missing.

#### Example

`"/Users/me/.tableau-mcp/cache/workbook-abc123.xml"`

:::note
LUID filtering with `workbookFile` requires an explicit live session.
:::

<hr />

### `verbosity`
How much detail each field carries: `full` (default), `slim` or `model`.

- `full` — returns a human-readable table of dimensions and measures plus a `fields` array carrying full metadata, including the fully-qualified `column_ref` for each field.
- `slim` — returns compact candidate tuples grouped by datasource, sorted into the three buckets an insight or a simple viz needs, and omitting `column_ref`.
- `model` — returns each datasource's data model instead of its fields: the logical tables, the physical joins and unions behind each, the relationships between tables with their field pairs, the number of visible measures, dimensions and relationships for each table (left to you to judge which table is the fact table), a count of visible fields tied to no table, and problems worth a review, such as a table in no relationship or a relationship that is many-to-many because its cardinality was never set.

Defaults to `full`. `hasLuid` and `luids` are accepted only alongside `slim`; supplying either with `full` or `model` is refused before anything is read.

#### Example

`"slim"`

#### Output shapes

The verbosities return different result shapes:

- `full` produces `{ message, fields }` — `message` is a formatted dimensions/measures table (or a "no fields found" note for an empty workbook), and `fields` is a flat array spanning all datasources, each field carrying its own `datasource`, `column_ref`, and (for a published datasource) `contentUrl`.
- `slim` produces `{ datasources }` — one group per datasource, in first-seen order, so the datasource identity is carried once per group rather than repeated on every field. A single-datasource workbook is still one group, so callers always parse the same structure. Each group holds three arrays of positional tuples: `measures` (`[caption, localName, aggregation, "base" | "aggregatedCalc"]`) for numeric measures, `timeDimensions` (`[caption, localName, "date" | "datetime"]`), and `breakdownDimensions` (`[caption, localName, "nominal" | "ordinal"]`). A field that fits none of those three buckets is left out of the slim result entirely. When `hasLuid` is set, each surviving group also carries `luid` and the datasource's friendly `name`.
- `model` produces `{ message, datasources }` — `message` is a plain-text summary, and each datasource carries `tables`, `relationships`, `problems` and `notes`. Each table carries `measures` and `dimensions` (omitted when no field carries a logical table id) and `relationships`, all counted from the workbook XML. The per-table counts cover the visible fields Tableau ties to that table. Calculations are not tied to a table, so when at least one field is tied to a table they are counted separately in `untiedFields` (`{ measures, dimensions }`), and the summary adds a line such as `9 fields not tied to a table (mostly calculations): 7 measures, 2 dimensions` when that count is above zero. When no field is tied to any table (a legacy datasource, or one without object ids), field ownership is unknown, so `untiedFields` is omitted and the summary shows no such line. Hidden fields are not counted anywhere.

:::note
`hasLuid` and `luids` require `verbosity: slim`. Supplying either with `full` or `model` is refused with `hasLuid and luids require verbosity: slim.`
:::

<hr />

### `hasLuid`

Boolean. Narrows a `slim` listing to the datasources the running %product_name% instance reports a LUID for — the published, non-federated ones — and stamps each surviving group with that `luid` and the datasource's friendly `name`. Groups whose datasource carries no LUID (embedded or local datasources) are dropped. Requires `verbosity: "slim"`. Omitting it, or passing `false`, leaves the slim result unfiltered.

#### A live session is required

Matching a field group to a LUID means reading the open workbook's datasource inventory from the running instance, so this filter cannot be served from a cache file alone. If you pass a `workbookFile`, you must also name an explicit `session`; leaving `session` out — or passing the placeholder value `default`, which counts as leaving it out — is refused before anything is read. With no `workbookFile` the workbook is already being read live, so no extra argument is needed.

:::note[When nothing carries a LUID]
Two situations fail rather than returning an empty list, because an empty list would read as "this workbook has no eligible fields" when the real cause is an identity mismatch. If the workbook's field datasources cannot be matched to the instance's datasource inventory at all, the error names both sets of identities. If they do match but none of the matches carries a LUID, the error names the matched datasources instead.
:::

#### Example

`true`

:::note
`luids` requires `hasLuid: true`. Supplying `luids` without it is refused with `luids requires hasLuid: true.`
:::

<hr />

### `luids`

Array of LUID strings, each non-empty, selecting exactly which LUID-backed datasources to return. Only groups whose datasource carries one of the listed LUIDs are kept. Requires `hasLuid: true` — supplying `luids` on its own is refused — and therefore `verbosity: "slim"` as well. An empty array behaves the same as omitting the argument: every LUID-backed datasource is returned.

#### Every requested LUID must match

If any LUID in the array matches no datasource in the open workbook, the whole call fails with an error listing the LUIDs that did not match, alongside those that did. The tool does not return a partial result for the LUIDs that happened to match.

#### Example

`["9a8b7c6d-1234-4a5b-8c9d-0e1f2a3b4c5d"]`

## Notes and caveats

- **Field datasource identities have to match the workbook's datasource metadata.** When they do not, the tool refuses with `Could not match workbook field datasource identities (<field identities>) to workbook datasource metadata (<workbook identities>).`
- **One field datasource must match one workbook datasource.** When a field datasource matches more than one, the tool refuses with `Datasource "<name>" matched multiple workbook datasources: <identities>.`

## Example results

### Full verbosity (default)

```json
{
  "message": "Found 2 fields in \"Sample - Superstore\":\n\nDIMENSIONS (1):\nName                           | Local Name                     | Type\n-------------------------------+--------------------------------+----------------\nCategory                       | (same)                         | N (Text)\n\nMEASURES (1):\nName                           | Local Name                     | Type\n-------------------------------+--------------------------------+----------------\nProfit                         | (same)                         | Q (Number (decimal))\n",
  "fields": [
    {
      "datasource": "Sample - Superstore",
      "contentUrl": "SuperstoreDS",
      "columnName": "[Profit]",
      "columnInstanceName": "[sum:Profit:qk]",
      "derivation": "Sum",
      "type": "quantitative",
      "role": "measure",
      "datatype": "real",
      "isAggregated": false,
      "column_ref": "[Sample - Superstore].[sum:Profit:qk]"
    },
    {
      "datasource": "Sample - Superstore",
      "contentUrl": "SuperstoreDS",
      "columnName": "[Category]",
      "columnInstanceName": "[none:Category:nk]",
      "derivation": "None",
      "type": "nominal",
      "role": "dimension",
      "datatype": "string",
      "isAggregated": false,
      "column_ref": "[Sample - Superstore].[none:Category:nk]"
    }
  ]
}
```

### Slim verbosity (`verbosity: "slim"`)

```json
{
  "datasources": [
    {
      "datasource": "federated.0abc123",
      "measures": [["Profit", "Profit", "Sum", "base"]],
      "timeDimensions": [["Order Date", "Order Date", "date"]],
      "breakdownDimensions": [["Category", "Category", "nominal"]]
    }
  ]
}
```

### LUID-filtered slim verbosity (`verbosity: "slim"`, `hasLuid: true`)

Each surviving group gains the datasource's `luid` and its friendly `name`; datasources without a LUID are gone:

```json
{
  "datasources": [
    {
      "datasource": "federated.0abc123",
      "measures": [["Profit", "Profit", "Sum", "base"]],
      "timeDimensions": [["Order Date", "Order Date", "date"]],
      "breakdownDimensions": [["Category", "Category", "nominal"]],
      "name": "Sample - Superstore",
      "luid": "9a8b7c6d-1234-4a5b-8c9d-0e1f2a3b4c5d"
    }
  ]
}
```

### No fields found (full verbosity)

```json
{
  "message": "No fields found in the workbook datasources.",
  "fields": []
}
```

## Related

- `get-xml` — read the full structure (XML) of the open workbook.
- `get-datasources` — list the datasources in the open workbook.
