---
sidebar_position: 5
---

# Save Cached Workbook Draft

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Saves workbook or worksheet XML to a cache file on the server's local machine, so it can later be applied to the workbook open in %product_name% with an `apply-*` tool. The supplied XML is checked for well-formedness before anything is written, and the target path must resolve inside the server's cache directory. There are two ways to write:

- Full write (no selector) — the file is created or overwritten with the XML you supply.
- Targeted splice (`worksheetName` or `dashboardName` selector) — only the named element is replaced inside an existing file, leaving its siblings untouched, so a client never has to round-trip a whole large document.

`worksheet` and `dashboard` are deprecated aliases of `worksheetName` and `dashboardName`, kept working for existing callers. A selector names an element *within* the file; it plays no part in deciding which file is written. That is decided by `filePath` alone.

## APIs called

This tool does **not** call the Tableau Cloud or Tableau Server REST API, and it makes **no** call to the local %product_name% %ecapi_name% either. It only writes a file to the server's local cache directory, so there are no OAuth scopes and no per-session bearer token involved in the write itself.

- Validates that the supplied XML is well-formed before writing — validated in-process (not an API call). If validation fails, nothing is written.
- Writes (or splices) the XML to the target file. Local filesystem; no API call. The path comes from `filePath` and nothing else, and must resolve within the server's configured cache directory: a path outside it — including a sibling that merely shares the directory's name as a prefix — is rejected before any write.
  - The `worksheetName` / `dashboardName` selectors are **not** part of that path. They are never appended to a directory, joined into a filename, or otherwise used to locate a file; they name the element to replace, and are matched against the `name` attribute of elements inside the file that `filePath` already selected.

## Required arguments

### `filePath`

Absolute path to the cache file to write, on the server's local machine, and the **only** argument that determines which file is written. The path must resolve inside the server's cache directory; a path outside it is rejected and nothing is written. When a `worksheetName` or `dashboardName` selector is supplied, the file must already exist so the selected element can be spliced into it.

#### Cache-directory containment

The resolved path has to be the cache directory itself or a descendant of it, and the check runs before anything is written. A prefix match is not enough: sibling paths that merely start with the same characters (for example a directory named like the cache directory plus a suffix, or a file whose name begins with the cache directory's name) are rejected as a security error, and nothing is written. No other argument can widen this — the element selectors below are applied to the file's contents, never to the path.

#### Example

```json
{ "filePath": "/Users/me/.tableau-mcp/cache/worksheet-studio-1.xml" }
```

:::note
The tool refuses before anything is written: file path must be within cache directory. Cache directory and the requested path are named in the refusal. A path that is not a regular file is also refused: file path must resolve to a regular file within the cache directory. New cache files must be direct children of the cache directory; a new file in a nested directory is refused. An existing regular file inside the cache directory can still be updated.
:::

<hr />

### `xmlContent`

The XML to save. It must be well-formed; malformed XML is rejected before any write. In a full write this becomes the entire file contents. With a `worksheetName` or `dashboardName` selector it must instead be a single top-level element whose tag and `name` match the selector (for example a `<worksheet name="Sales">…</worksheet>` element when splicing the `Sales` worksheet).

#### Example

```json
{ "xmlContent": "<worksheet name=\"Sheet1\"><table/></worksheet>" }
```

:::note
Content validation failed with error(s): Fix these errors before writing. The refusal names how many errors were found and lists each one, and nothing is written.

Splice target mismatch: the selector is the worksheet or dashboard name you passed, so xmlContent must be an element of that tag and that name, but its outer element differed. Fix the selector or content so both name the same worksheet or dashboard; nothing was written.
:::

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected). If a session is named that does not correspond to a running %product_name% instance, the write is rejected and no file is written.

#### Example

`"77700"`

<hr />

### `worksheetName`

Name of a worksheet to replace in the existing file, by a targeted splice. When set, only the matching `<worksheet name="…">` element in the file at `filePath` is replaced with `xmlContent`; every sibling element is left intact. Do not combine with `dashboardName` — pass exactly one selector.

#### Targeted splice

The splice is guarded so a mistyped or mismatched fragment can never overwrite the wrong element:

- The outer element of `xmlContent` must be exactly a `<worksheet>` whose `name` equals this selector; a mismatched tag or name is rejected without writing. Names are compared as literal text after XML-entity decoding, so a plain-text selector matches an escaped `name` attribute (for example `Sales & Profit` matches `name="Sales &amp; Profit"`).
- The file must already exist and contain a `<worksheet name="…">` element with that name; if it is missing, the call errors and nothing is written.

#### Example

`"Sales"`

<hr />

### `worksheet`

Deprecated alias of `worksheetName`, kept working so existing callers do not break. Prefer `worksheetName`. Passing both is allowed only when they are identical; if they disagree, the call is refused with an error naming both values and nothing is written.

#### Example

`"Sales"`

:::note
Multiple selectors provided: a worksheet selector and a dashboard selector together, including `worksheetName` or `dashboardName` and the deprecated aliases. Pass exactly one of worksheet or dashboard so the splice target is unambiguous — re-call with a single selector. Nothing was written.
:::

<hr />

### `dashboardName`

Name of a dashboard to replace in the existing file, by a targeted splice. Behaves exactly like `worksheetName`, except the matching element is a `<dashboard name="…">`. Do not combine with `worksheetName` — pass exactly one selector.

#### Example

`"Main"`

<hr />

### `dashboard`

Deprecated alias of `dashboardName`, with the same conflict rule: pass one or the other, and supplying both is allowed only when they are identical.

#### Example

`"Main"`

## Notes and caveats

- **Pass at most one splice selector.** Supplying both a worksheet name and a dashboard name is rejected — the tool names both offending selectors and writes nothing, so the target element is never ambiguous. A `*Name` argument and its deprecated alias count as one selector when they agree.
- **A missing element writes nothing.** When no `<worksheet>` or `<dashboard>` element with that name is found, nothing is written. The selector is the plain worksheet or dashboard name (A & B), not the XML-escaped form from the raw file (A &amp; B); use `get-sheets` to get exact names.
- **Every rejection happens before the file is touched.** A path outside the cache directory, malformed XML, a splice target that is missing or does not match the selector, and an unresolvable session are all caught up front, so a failed call never leaves a partially-written or corrupted file.
- **The result reports the UTF-8 byte count written.** A full write reports the bytes written to the file; a splice reports the byte size of the resulting spliced file, which includes the untouched siblings, not just the replaced fragment.

## Example results

### Full write

```json
{
  "message": "Wrote 45 bytes to /Users/me/.tableau-mcp/cache/worksheet-studio-1.xml\n\nFile is ready to use with apply-* tools."
}
```

### Targeted splice (`worksheetName: "Sales"`)

```json
{
  "message": "Spliced edit into 512 bytes in /Users/me/.tableau-mcp/cache/workbook-studio-1.xml\n\nFile is ready to use with apply-* tools."
}
```

## Related

- `get-xml` — writes the workbook or one sheet to the cache file that this tool edits.
- [`apply-workbook`](../workbook/apply-workbook.md) — applies an edited cache file back to the workbook open in %product_name%.
- [`apply-worksheet`](../worksheet/apply-worksheet.md) — applies an edited worksheet cache file back to %product_name%.
