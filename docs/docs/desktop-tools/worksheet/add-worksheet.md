---
sidebar_position: 1
---

# Add Worksheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Add a blank worksheet to the open workbook. It becomes the active sheet; get its id from `get-sheets`. %product_name% assigns the new sheet a generated name; pass `index` to choose the tab position, or omit it to append the sheet at the end.

:::note[Not read-only]
This tool is not read-only and not idempotent. Each call adds another blank worksheet to the live %product_name% session, so repeating the call is not a no-op.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to add a blank worksheet to the open workbook. Requires a connected %product_name% session with a workbook open; authorized by that session's loopback bearer token. The request carries no body; `index`, when supplied, is sent as a query parameter.
  - `POST /v<x>/workbook/worksheets:new` — create a blank worksheet (append, or insert at `index` when given). [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/addWorksheet)

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

<hr />

### `index`
0-based tab position for the new worksheet. Integer. Range: 0 and above. When omitted, the worksheet is appended at the end of the tab strip.

#### Tab position

`0` inserts before the first existing tab, shifting the others to the right. A value greater than or equal to the current number of tabs appends at the end, the same as omitting `index`.

#### Example

`2`

## Notes and caveats

- **The result does not include the generated name.** The tool reports that the worksheet was added (or that the request is still being applied), not what %product_name% named it. Use `get-sheets` to see the names in the open workbook.
- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the change has settled, the result says a new worksheet was requested and is still being applied instead of claiming it completed.

## Example results

### Worksheet added

```json
{ "message": "Added a blank worksheet." }
```

### Accepted, still being applied

```json
{ "message": "Requested a new worksheet; Desktop is still applying it." }
```

## Related

- `get-sheets` — lists worksheet names in the open workbook, including the generated name of the sheet just added.
- `get-xml` — reads the new worksheet's structure once you know its name.
- [`apply-worksheet`](apply-worksheet.md) — replaces an existing worksheet with prepared content; it does not create the blank sheet this tool adds.
