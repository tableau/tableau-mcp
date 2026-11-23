---
sidebar_position: 6
---

# Find Field Reference

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Disambiguates a field name to its exact column reference (`column_ref`) — the
`Country`-vs-`Country1` class of problem where a human-readable name maps to more
than one underlying column. It matches the name against the fields in a local
`%product_name%` workbook snapshot; with `workbookFile` omitted it takes that
snapshot itself, reading the workbook open in the running `%product_name%`
instance. It reports one of four outcomes:

- `exact` — the name resolves to a single column; the `column_ref` is returned
- `rewritten` — the name resolves after a rewrite (for example, `sum of Profit`); the `column_ref` is returned
- `ambiguous` — the name matches more than one column; the candidates are returned so the caller can choose
- `not_found` — no column matches the name

`rewritten`, `ambiguous` and `not_found` are reported with `isError: true` in the result body
(the tool call itself still succeeds).

## APIs called

Acts on the open `%product_name%` workbook via a local workbook snapshot file. The
name is always matched in-process. The tool reaches the local `%product_name%`
`%ecapi_name%` — a REST API the running `%product_name%` instance serves at
`http://127.0.0.1:<port>/v<x>` (authorized by a per-session loopback bearer token,
where `<x>` is the latest API version) — whenever it has to take a snapshot:
always when `workbookFile` is omitted, and once as a self-heal when a supplied
snapshot yields no match.

- Take a fresh snapshot when `workbookFile` is omitted: read the open workbook,
  write it to a new local snapshot file, and match the name against that.
  - `GET /v<x>/workbook/document` — read the current workbook document from the
    running `%product_name%` instance. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - Writing the new snapshot file and its session companion file is a local
    filesystem write; no `%ecapi_name%` call.
- Resolve the field name against a supplied snapshot file. Reads the snapshot
  file from the local filesystem and matches the name in-process; no
  `%ecapi_name%` call.
- Self-heal a supplied snapshot that yielded no match: re-read the live workbook
  once, rewrite that same snapshot file, and retry the match. This is bounded to a
  single refresh (no loop).
  - `GET /v<x>/workbook/document` — re-read the current workbook document.
    [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - Rewriting the local snapshot file and its session companion file is a local
    filesystem write; no `%ecapi_name%` call.

## Required arguments

### `query`
The field name to resolve — the human-readable name the caller wants mapped to a
`column_ref`. String.

#### Example

```json
{ "query": "Profit" }
```

## Optional arguments

### `workbookFile`
Absolute path to a local workbook snapshot file (the cached workbook XML) whose
fields are searched. String. This is a path an earlier call handed back — every
result carries the `workbookFile` it read — not a workbook or sheet name. A
supplied path must exist; a missing one is reported as a file-not-found error
rather than quietly falling back to a live read.

#### Omit it to read the workbook live

With `workbookFile` omitted — an empty or whitespace-only value counts as
omitted — the tool reads the workbook open in the running `%product_name%`
instance, writes that snapshot to a **new** cache file, and resolves against it.
The path it minted is returned as `workbookFile`, so a follow-up call can pass it
back and reuse the same snapshot instead of re-reading `%product_name%`.

:::note[Reading live spends the self-heal]
The one-shot refresh described under `session` exists to rule out a stale
snapshot, so it applies only when you supply one. With `workbookFile` omitted the
XML being searched is already the live workbook, and a `not_found` is final: it
comes back with the "the field genuinely does not exist in the current workbook"
guidance rather than a second read.
:::

#### Example

```json
{ "workbookFile": "/Users/me/.tableau-mcp/cache/workbook-abc123.xml" }
```

<hr />

### `datasource`
Restricts resolution to a single datasource by name, so a name that appears in
more than one datasource resolves within only the named one. String. When omitted,
all datasources in the workbook are searched.

#### Example

```json
{ "datasource": "Sample - Superstore" }
```

<hr />

### `session`
The `%product_name%` session id (for example, `12345`) identifying the running
instance to read from. String. When omitted, the session is resolved
automatically — the pinned instance, or the only one running — so a live read
still happens without naming one; it fails only when no instance is running or
when several are and none is pinned.

#### Self-heal on not_found

When a supplied `workbookFile` yields no match, the tool re-reads the live
workbook from the running `%product_name%` instance, rewrites that snapshot file,
and retries the match once. This covers a datasource or field that was connected
after the snapshot was written and is therefore invisible to a snapshot-only read.
The retry is bounded to one refresh, whether or not `session` was named.

:::note
A refresh failure never surfaces as a tool error. If the live read fails — or the
session cannot be resolved — the tool degrades to the original `not_found`
result, marks it `stale_not_found` with `stale: true`, and appends guidance (the
failure reason plus a suggested next step, such as checking the session) to the
result body, so the outcome is never dropped and a stale miss is never mistaken
for proof the field is absent.
:::

## Example results

Every result carries a `status` (`resolved`, `ambiguous`, `not_found`, or
`stale_not_found`) and the `workbookFile` the match was made against — the path
you passed, or the one the tool minted when you omitted it. `isError` is a legacy
mirror of `status`: it is `true` for anything other than `resolved`.

### Exact match (`kind: "exact"`)

```json
{
  "resolution": {
    "kind": "exact",
    "query": "Profit",
    "column_ref": "[Sample - Superstore].[sum:Profit:qk]",
    "datasource": "Sample - Superstore"
  },
  "status": "resolved",
  "workbookFile": "/Users/me/.tableau-mcp/cache/workbook-abc123.xml",
  "isError": false
}
```

### Ambiguous match (`kind: "ambiguous"`)

```json
{
  "resolution": {
    "kind": "ambiguous",
    "query": "Profit",
    "candidates": [
      {
        "column_ref": "[DS1].[sum:Profit:qk]",
        "datasource": "DS1",
        "column_name": "[Profit]",
        "role": "measure",
        "is_aggregated": false
      },
      {
        "column_ref": "[DS2].[sum:Profit:qk]",
        "datasource": "DS2",
        "column_name": "[Profit]",
        "role": "measure",
        "is_aggregated": false
      }
    ],
    "reason": "\"Profit\" matches 2 fields. Disambiguate with options.datasource or by picking a column_ref."
  },
  "status": "ambiguous",
  "workbookFile": "/Users/me/.tableau-mcp/cache/workbook-abc123.xml",
  "isError": true
}
```

### No match (`kind: "not_found"`)

The name did not resolve even after the workbook was read live, so `note` says so
plainly:

```json
{
  "resolution": {
    "kind": "not_found",
    "query": "NonExistent",
    "candidates": [],
    "reason": "no match for \"NonExistent\"."
  },
  "status": "not_found",
  "workbookFile": "/Users/me/.tableau-mcp/cache/workbook-abc123.xml",
  "isError": true,
  "note": "Refreshed the workbook live from Tableau and \"NonExistent\" still does not resolve. The field genuinely does not exist in the CURRENT workbook — stop re-reading stale caches. Call list-available-fields (with session) to see the fields that DO exist, or ask-user to clarify."
}
```

### Unrefreshable snapshot (`status: "stale_not_found"`)

The supplied snapshot yielded no match and the live re-read failed, so the miss is
reported as possibly stale rather than as an error:

```json
{
  "resolution": {
    "kind": "not_found",
    "query": "Profit",
    "candidates": [],
    "reason": "no match for \"Profit\"."
  },
  "status": "stale_not_found",
  "workbookFile": "/Users/me/.tableau-mcp/cache/workbook-abc123.xml",
  "isError": true,
  "stale": true,
  "note": "Attempted a live refresh from Tableau to rule out a stale cache, but it failed."
}
```

## Related

- [`list-available-fields`](./list-available-fields.md) — lists the datasource fields available in the open workbook, the population this tool disambiguates against
- [`add-field`](./add-field.md) — places a field on a worksheet shelf once its exact reference is known
