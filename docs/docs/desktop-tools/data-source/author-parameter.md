---
sidebar_position: 4
---

# Author Parameter

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Adds a new parameter to the workbook open in the local %product_name% instance. You supply the parameter's caption, data type, and current value — and, optionally, a fixed list of allowable values — and the tool injects the parameter into a host datasource's Parameters dependency block, then applies that document in place. The session is unchanged.

:::note[Not read-only]
This tool is not read-only and is not idempotent. It writes the new parameter into the live workbook. Repeating the call with the same caption is rejected as a collision.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` (where `<x>` is the latest API version); each call is authorized by that session's per-session bearer token over the loopback interface, and there are no OAuth scopes.

- Reads the open workbook's XML to inventory existing parameters and reject a caption that already exists.
  - `GET /v<x>/workbook/document` — read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Injects a Parameters dependency block onto a host datasource (the optional `datasource`, or one the tool selects) and builds the new parameter column. Done in-process; no API call.
- Applies the edited workbook document to the running instance and reads it back until the new parameter caption is present.
  - `POST /v<x>/workbook/document` — replace the open workbook from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
  - `GET /v<x>/workbook/document` — re-read the open workbook's XML to confirm the parameter materialized. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)

## Required arguments

### `caption`

The parameter's display name (its caption in %product_name%). Must be non-empty, and must not match the caption of a parameter that already exists in the workbook — a collision is rejected before anything is applied.

#### Example

`"p.Period"`

:::note
An empty caption is refused with `caption empty`. A caption that matches a parameter already in the workbook is refused before anything is applied, with `caption collision — that parameter already exists; pick a new caption`.
:::

<hr />

### `value`

The parameter's current value, given as a string. This seeds both the parameter's current value and its calculation formula. For `string` and `date` parameters the value is quoted automatically; for `integer`, `real`, and `boolean` parameters it is used as-is.

#### Example

`"Month"`

## Optional arguments

### `datatype`

The parameter's data type. One of `integer`, `real`, `string`, `boolean`, or `date`. Defaults to `integer`.

- `integer`, `real`, `boolean` — the value is used unquoted; `integer` parameters are additionally marked as customized.
- `string`, `date` — the value (and any `members`) are quoted.

#### Example

`"string"`

<hr />

### `members`

An optional list of allowable values for the parameter. When one or more members are supplied, the parameter is created as a list parameter, so only those values are selectable; when omitted, the parameter accepts any value of its data type. Members follow the same quoting as `value` (quoted for `string` and `date`).

#### Example

```json
{ "members": ["Month", "Quarter", "Year"] }
```

<hr />

### `datasource`
Host datasource id or name that should carry the Parameters dependency block. When omitted, the tool selects a host datasource from the open workbook.

#### Example

`"Sample - Superstore"`

:::note
The host is a datasource other than Parameters.

- A name that matches nothing is refused with `Datasource "<name>" was not found. Candidates: <names>.`
- A caption shared by more than one datasource is refused with `Datasource caption "<name>" is ambiguous. Use an internal datasource name: <names>.`
- When `datasource` is omitted and more than one non-Parameters datasource is present, the tool refuses with `Multiple datasources found; specify datasource. Candidates: <names>.`
- When the workbook has no non-Parameters datasource, the tool refuses with `No non-Parameters datasource found.`
:::

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when it is pinned or exactly one %product_name% instance is connected). On success the session is unchanged.

#### Example

`"studio-1"`

## Notes and caveats

- **Applied in place; the session does not change.** The parameter is injected into a `<datasource-dependencies datasource='Parameters'>` block on a real host datasource and applied through the same document write used by sibling authoring tools. A bare top-level Parameters datasource is not sufficient — %product_name% reconstructs Parameters from that dependency block.
- **Readback must show the new caption.** If the apply finishes but the re-read does not contain the new parameter caption, the tool reports that the parameter did not materialize.

## Example result

### Applied in place

```json
{
  "parameterName": "[Parameter 2]",
  "caption": "p.Period",
  "applied": "in-place",
  "session": "12345",
  "hint": "parameter created in place; the session is unchanged — continue authoring against the same instance"
}
```

## Related

- [`apply-workbook`](../workbook/apply-workbook.md) — apply other edited workbook content to the open %product_name% workbook.
- `get-xml` — read the current workbook's structure.
