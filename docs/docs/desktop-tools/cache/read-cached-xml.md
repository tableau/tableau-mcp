---
sidebar_position: 2
---

# Read Cached Workbook Draft

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Reads a cached workbook or worksheet XML working copy from the MCP server's local cache directory and returns its contents. This is the read half of the cache read/edit/re-apply loop: another tool first writes a working copy into the cache, and this tool reads it back — optionally slicing out just one element or byte range so a large document never has to be pulled into the conversation whole.

Provide at most one optional selector to narrow the read:

- `worksheetName` — return only the named `<worksheet>` element from the cached file.
- `dashboardName` — return only the named `<dashboard>` element from the cached file.
- `startByte` / `endByte` — return only a byte range of the cached file.

Omit all selectors to read the entire cached file. `worksheet` and `dashboard` are deprecated aliases of `worksheetName` and `dashboardName`, kept working for existing callers.

A selector chooses an element *within* the file; it plays no part in deciding which file is opened. That is decided by `filePath` alone.


## APIs called

This tool performs a **local-filesystem read** only — it opens a file in the MCP server's cache directory and returns its contents. It makes **no** %ecapi_name% call and does not contact the Tableau Cloud or Server REST API, so no route is issued and no OAuth scopes are involved.

- Reads the cached XML working copy from the local filesystem and returns the requested slice. Local filesystem; no API call.
  - The path comes from `filePath` and nothing else. It is resolved to an absolute path that must stay **within the server's cache directory**. A path resolving outside that directory — including a sibling that merely shares the cache-directory name as a prefix — is rejected before any file is opened.
  - The `worksheetName` / `dashboardName` selectors are **not** part of that path. They are never appended to a directory, joined into a filename, or otherwise used to locate a file; they are matched against the `name` attribute of elements inside the file already selected by `filePath` and read into memory.

## Required arguments

### `filePath`

Path to the cached XML file to read, and the **only** argument that determines which file is opened. It is resolved to an absolute path and must fall within the server's cache directory; in practice this is a path handed back by a tool that previously wrote the working copy (for example, a worksheet or workbook read saved to cache). A path that resolves outside the cache directory is refused, and a path that resolves inside it but does not exist reports a "file not found" error.

#### Cache-directory containment

The resolved path has to be the cache directory itself or a descendant of it, and the check runs before the file is opened. A shared prefix is not enough: a sibling whose name merely begins with the cache directory's name is rejected as a security error. No other argument can widen this — the element selectors below are applied to the file's contents after it has been read, never to the path.

#### Example

```json
{ "filePath": "/path/to/cache/worksheet-Sales-abc123.xml" }
```

:::note
A path outside the cache directory is refused with `file path must be within cache directory.` The message names the cache directory and the path that was requested. A path that is not a regular file inside that directory is refused with `file path must resolve to a regular file within the cache directory.` That message names the same two paths, and a reason when the check can name one.
:::

## Optional arguments

### `worksheetName`

Name of a single `<worksheet name="...">` element to extract from the cached XML. When set, only that worksheet element is returned instead of the whole file; if no worksheet with that name exists in the cached document, the read is rejected and nothing is returned.

The value is matched against the `name` attribute of the `<worksheet>` elements in the file, after XML-entity decoding, so a plain-text selector matches an escaped attribute (for example `Sales & Profit` matches `name="Sales &amp; Profit"`). It is compared as literal text, not as a pattern, and it never contributes to the file path.

#### Example

`"Sales by Region"`

<hr />

### `worksheet`

Deprecated alias of `worksheetName`, kept working so existing callers do not break. Prefer `worksheetName`. Passing both is allowed only when they are identical; if they disagree, the read is refused with an error naming both values rather than guessing which one you meant.

#### Example

`"Sales by Region"`

:::note
Pass exactly one of `worksheet`, `dashboard`, or a `startByte`/`endByte` byte range. More than one is refused before the file is read, with `Multiple selectors provided: <selectors>. Pass exactly one of worksheet, dashboard, or a startByte/endByte byte range so the slice is unambiguous — re-call with a single selector.`
:::

:::note
If the file has no matching `<worksheet>`, the read is refused with `No <worksheet name="<name>"> element found in <file>.` The selector is the plain worksheet name (`A & B`), not the XML-escaped form from the raw file (`A &amp; B`); use `get-sheets` to get exact names.
:::

<hr />

### `dashboardName`

Name of a single `<dashboard name="...">` element to extract from the cached XML. When set, only that dashboard element is returned instead of the whole file; if no dashboard with that name exists in the cached document, the read is rejected and nothing is returned. It is matched the same way as `worksheetName` — literal text against the decoded `name` attribute — and likewise never affects the file path.

#### Example

`"Executive Summary"`

<hr />

### `dashboard`

Deprecated alias of `dashboardName`, with the same conflict rule: pass one or the other, and supplying both is allowed only when they are identical.

#### Example

`"Executive Summary"`

:::note
If the file has no matching `<dashboard>`, the read is refused with `No <dashboard name="<name>"> element found in <file>.` The selector is the plain dashboard name (`A & B`), not the XML-escaped form from the raw file (`A &amp; B`); use `get-sheets` to get exact names.
:::

<hr />

### `startByte`

Start of a byte range to return, as a non-negative integer offset into the file. `Range: 0 or greater.` Defaults to `0` (the start of the file) when omitted.

#### Byte range read

`startByte` and `endByte` together select the half-open byte range `[startByte, endByte)` of the cached file, measured in UTF-8 bytes. `startByte` defaults to `0` and `endByte` defaults to the end of the file, so either bound may be supplied on its own. Use a byte range to page through a large cached file when no single `worksheetName` or `dashboardName` element is what you need.

#### Example

`0`

<hr />

### `endByte`

End of the byte range to return (exclusive), as a non-negative integer offset into the file. `Range: 0 or greater.` Defaults to the end of the file when omitted. See [Byte range read](#byte-range-read) under `startByte` for how the two bounds combine.

#### Example

`4096`

## Notes and caveats

- Pass **at most one** selector per call — a worksheet name, a dashboard name, or a `startByte`/`endByte` byte range. Supplying more than one is rejected (the error names each selector received) so the requested slice is never ambiguous, and no file is read in that case. A `*Name` argument and its deprecated alias count as one selector when they agree.

## Example result

On success the tool returns a text message with the byte count, the file path, an optional slice label identifying the selected element or byte range, and the XML content:

```text
Read 45 bytes from /path/to/cache/worksheet-Sales-abc123.xml (worksheet "Sales")

<worksheet name="Sales"><table><rows>[Sales]</rows></table></worksheet>
```

When no selector is given, the slice label is omitted and the byte count reflects the full cached document, whose contents follow.

## Related

- [`write-cached-xml`](write-cached-xml.md) — writes an edited working copy back to the cache directory.
- [`validate-workbook-xml`](validate-workbook-xml.md) — validates a cached workbook XML working copy.
- [`validate-worksheet-xml`](validate-worksheet-xml.md) — validates a cached worksheet XML working copy.
