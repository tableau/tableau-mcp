---
sidebar_position: 5
---

# Add Storyboard

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Add a blank storyboard to the open workbook. It becomes the active sheet; get its id from `get-sheets`. The new storyboard is created with a generated name. Pass `index` to insert it at a 0-based tab position; omit `index` to append it at the end.

:::note[Not read-only]
This tool is not read-only and not idempotent. It adds a storyboard to the workbook in the live %product_name% session, so repeating the call creates another one.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to add a blank storyboard to the open workbook. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token. The request carries no body. When `index` is given, it is sent as a query parameter on the same call.
  - `POST /v<x>/workbook/storyboards:new` — add a blank storyboard to the open workbook. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/addStoryboard)

## Optional arguments

### `index`
0-based tab position for the new storyboard. Type: integer. Range: 0 and above. Omit to append at the end. `0` inserts before the first tab, shifting existing tabs at that position and beyond to the right. A value at or past the current tab count also appends.

#### Example

```json
{ "index": 0 }
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

- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the change has settled, the result says the storyboard was requested and is still being applied instead of claiming it completed.

## Example results

### Storyboard added

```json
{ "message": "Added a blank storyboard." }
```

### Accepted, still being applied

```json
{ "message": "Requested a new storyboard; Desktop is still applying it." }
```

## Related

- `get-sheets` — lists every storyboard in the open workbook, including the one just added.
- [`apply-storyboard`](./apply-storyboard.md) — replaces an existing storyboard's document; it does not create one.
