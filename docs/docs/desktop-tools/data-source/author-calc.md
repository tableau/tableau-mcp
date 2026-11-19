---
sidebar_position: 3
---

# Author Calc

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Authors a new calculated field — a caption plus a Tableau formula — into a datasource of the workbook open in %product_name%. The field is added to the datasource definition itself, so you can then reference it by caption when building a worksheet or dashboard.

:::note[Not read-only]
This tool modifies the workbook: it adds a new calculated field to the open %product_name% workbook. It is not read-only. A retry with the same caption, formula, role, and datatype returns the existing field without writing; a different definition under an existing caption is refused as a caption collision.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Reads the current workbook's XML from the running %product_name% session.
  - `GET /v<x>/workbook/document` — read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Checks the caption, resolves caption references, chooses the target datasource, and assembles the edited document. Done in-process (not an API call). When an identical field already exists, the tool returns it here and makes no further calls.
- Lists the workbook's datasources to resolve the target datasource's id.
  - `GET /v<x>/workbook/datasources` — list the open workbook's datasources. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/listWorkbookDatasources)
- Validates the formula with %product_name%'s calculated-field validator. An invalid formula is refused with %product_name%'s message, and nothing is applied.
  - `POST /v<x>/workbook/datasources/{id}:validateCalculatedField` — validate the formula against the target datasource. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/validateDatasourceCalculatedField)
- Applies the edited workbook document to the open %product_name% workbook, replacing it.
  - `POST /v<x>/workbook/document` — replace the open workbook from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Reads the workbook back to confirm the new field's internal name and caption are present; if they are not, the tool reports that the load completed but did not apply.
  - `GET /v<x>/workbook/document` — re-read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)

## Required arguments

### `caption`

The display name for the new calculated field. Type: string. Must be non-empty after trimming leading and trailing whitespace.

#### Caption collision

If the target datasource already has a field with this caption whose formula, role, or datatype differs, the tool refuses with `caption collision — pick a new caption or use the existing field` and writes nothing. An existing field with the same formula, role, and datatype is reused.

:::note[Refusals]
An empty caption is refused with `caption empty` before the workbook is read. This tool submits one calculation, so the batch messages for a repeated caption or a numbered empty caption are not returned.
:::

#### Example

`"Profit Margin"`

<hr />

### `formula`

The Tableau calculation formula for the field. Type: string. Must be non-empty after trimming.

#### Caption references

The formula may reference other fields by their captions (for example, `[Sales]`). Before authoring, the tool rewrites those caption references to the datasource's internal field names, so references to sibling calculated fields resolve correctly and parameter references are qualified as `[Parameters].[…]`. A reference whose caption already matches its internal name (a base field) is left unchanged.

:::note[Refusals]
An empty formula is refused with `formula empty` before the workbook is read.
:::

#### Example

`"[Sales] * 0.2"`

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

<hr />

### `role`

Whether the new field is a measure or a dimension. One of `measure` or `dimension`. Defaults to `measure`.

Together with `datatype`, the role determines the field's internal type: a `measure` with a `real` or `integer` datatype is authored as quantitative, and every other combination is authored as nominal. Any other value is rejected by the argument schema before the call runs.

#### Example

`"dimension"`

:::note
- `invalid role`
:::

<hr />

### `datatype`

The data type of the new field. One of `real`, `integer`, `string`, `boolean`, `date`, or `datetime`. Defaults to `real`. Any other value is rejected by the argument schema before the call runs.

#### Example

`"string"`

:::note
- `invalid datatype`
:::

<hr />

### `datasource`
Name of the workbook datasource to add the field to. Type: string. When omitted, the tool targets the workbook's single non-`Parameters` datasource automatically.

#### Datasource selection

If the workbook has more than one datasource (excluding the built-in `Parameters` datasource), you must name the target with `datasource`; otherwise the tool lists the candidate datasources and asks you to choose. If the named datasource is not found, the tool returns the list of available candidates so you can correct the name.

:::note[Refusals]
- `Datasource "<name>" was not found. Candidates: <names>.` — the message lists up to five candidate names
- `Datasource caption "<caption>" is ambiguous. Use an internal datasource name: <names>.`
- `Multiple datasources found; specify datasource. Candidates: <names>.`
- `No non-Parameters datasource found.`
- `Datasource "<name>" has no id in the %product_name% datasource list.` — the resolved datasource is not in the running %product_name% datasource list
:::

#### Example

`"Superstore"`

:::note
- `Datasource "Superstore" has no id in Tableau Desktop's datasource list.`
:::

## Notes and caveats

- **The field is authored, not placed.** The calculated field is added to the datasource definition only; it is not dropped onto any worksheet or dashboard. The success result includes a `hint` describing how to reference it by caption in a subsequent charting request.
- **Apply is verified by readback.** After applying the edited document, the tool re-reads the workbook and confirms the new field's internal name and caption are present. If the read-back document does not contain them, the tool reports that the load completed but did not apply, rather than a success.
- **An empty calculation list is refused** with `at least one calculation is required`. This tool's arguments are one caption and one formula.
- **An unresolved field reference in the formula is refused.** An unbracketed name that does not resolve to one field is reported as `field reference [<name>] was not found` or `field reference [<name>] is ambiguous`. When the workbook has candidates, that message continues with ` <one of: ...>` and lists up to three names. A name that matches more than one parameter is reported as `field reference [<name>] is ambiguous between parameters: <names>`.
- **A calculation that was not processed is refused** with `internal error: calculation "<caption>" was not processed`.

## Example result

### Successful author (`role: "measure"`, `datatype: "real"`)

```json
{
  "calcName": "[Calculation_1700000000000]",
  "caption": "Profit Margin",
  "datasource": "Superstore",
  "hint": "reference it by caption in a build-worksheets-from-templates fieldMapping (name the caption plus a chart shape)"
}
```

## Related

- `get-xml` — reads the structure of the open workbook, including its datasources and existing fields.
- [`apply-workbook`](../workbook/apply-workbook.md) — applies edited workbook content back to %product_name%.
