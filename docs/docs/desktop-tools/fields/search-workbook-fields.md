---
sidebar_position: 6
---

# Search Workbook Fields

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Searches fields and calculations in the workbook currently open in the connected %product_name% instance. Matches are case-insensitive. Each hit includes explicit Rows, Columns, and Marks placements across worksheets. The search reads the live workbook; it does not use cached files or published site content. This is a read-only operation.

## APIs called

This tool reads the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood the workbook document is fetched from the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. Matching fields and collecting shelf placements is done in process against that document.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the open workbook document. Authorized by the session's loopback bearer token; requires a workbook to be open.
  - `GET /v<x>/workbook/document` — read the open workbook document. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Searches field captions, local names, formulas, folders, and datasource names, and records Rows, Columns, and Marks placements. Parsed in-process; not an API call.

## Required arguments

### `query`

Case-insensitive text to find in workbook fields. Type: string. Minimum length: 1 after trim.

#### Example

`"Sales"`

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when it is pinned or exactly one %product_name% instance is connected).

#### Example

`"12345"`

<hr />

### `limit`

Maximum number of matches to return. Type: integer. Range: 1–100. Default: `20`. When more fields match, `truncated` is `true` and `totalMatches` still reports the full count.

#### Example

`20`

## Notes and caveats

- **Live workbook only.** The search does not read cache files and does not query published Tableau Cloud or Server content.
- **Placements are shelf and Marks encodings only.** The `usageScope` in the result is `worksheet shelves and mark encodings only`.

## Example result

### Matches found

```json
{
  "query": "Sales",
  "totalMatches": 1,
  "truncated": false,
  "usageScope": "worksheet shelves and mark encodings only",
  "matches": [
    {
      "datasource": "Sample - Superstore",
      "caption": "Sales",
      "localName": "Sales",
      "columnRef": "[Sample - Superstore].[sum:Sales:qk]",
      "role": "measure",
      "datatype": "real",
      "matchedOn": ["caption", "localName"],
      "placements": [
        { "worksheet": "Overview", "location": "columns" }
      ]
    }
  ]
}
```

## Related

- [`list-available-fields`](./list-available-fields.md) — list datasource fields available for authoring (does not report worksheet placements).
