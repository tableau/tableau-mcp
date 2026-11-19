---
sidebar_position: 3
---

# Build Worksheet From Template

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Builds one finished worksheet from a chart template and the fields of the workbook currently open in %product_name%, without changing anything in that workbook. You name the template, the worksheet title, the live datasource, and which live field fills each of the template's slots; the tool reads the open workbook, binds the template to those fields, and keeps the finished worksheet as an *artifact* — a prepared worksheet held by this MCP server and identified by the `artifactId` it returns.

The artifact is the unit of work that a later step applies. Nothing appears in %product_name% until that `artifactId` is applied: [`apply-worksheet`](../worksheet/apply-worksheet.md) applies a single artifact, and `run-dashboard-batch` applies several artifacts in order and composes them into a dashboard.

:::note[Read-only]
Building an artifact reads the open workbook and writes nothing back to it, so the tool is marked read-only. It is not idempotent: each call mints a new artifact with a new id, even for identical arguments.
:::

## APIs called

This tool reads the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. That loopback call carries **no OAuth scopes**; it is authorized by the running %product_name% instance's **per-session bearer token** over the loopback interface. Exactly one call crosses to %product_name% — the workbook read — and everything after it happens in-process, which is why the open workbook is left untouched.

- Resolves which %product_name% session to target by reading the local instance-discovery files written by %product_name%.
  - Local filesystem; no %ecapi_name% call.
- Reads the open workbook once, both for the schema the field mapping is checked against and for the state the artifact is later applied over. The read must identify which running instance served it; the artifact records that instance so it can only be applied back to the same one.
  - `GET /v<x>/workbook/document` — read the current workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Reads the named template from the template library.
  - Local filesystem; no %ecapi_name% call.
- Binds each template slot to its mapped field, builds the worksheet against a copy of the workbook that was read, and validates the result. Performed in-process; not an %ecapi_name% call, and nothing is posted back to %product_name%.
- Stores the finished worksheet as an artifact held by this MCP server and returns its id and bindings. In-memory to the MCP server; no %ecapi_name% call and no file written.

## Required arguments

### `templateName`

Identifier of the worksheet template to build from. It must name a template the library can read and one that is eligible for worksheet template application; an unknown, unreadable, or ineligible template is refused before the workbook is touched. Browse the available identifiers with [`list-templates`](../binder/list-templates.md), whose `pass1EligibleOnly` filter narrows the list to the templates this tool accepts.

#### Example

```json
{ "templateName": "ranking-ordered-bar" }
```

:::note
Template "the template name" is not available. Template "the template name" could not be read. Template "the template name" is not eligible for worksheet template application. Template "the template name" did not produce a complete worksheet artifact.
:::

<hr />

### `title`

The name to give the worksheet being built. It is the name the artifact carries, and the worksheet name that appears once the artifact is applied.

#### Example

`"Revenue by Segment"`

<hr />

### `datasource`

Name of the live datasource in the open workbook that the mapped fields belong to.

This is checked, not trusted: the tool binds the mapping first and then compares the datasource the mapping actually resolved to against the one you named. On a disagreement it refuses and names the resolved datasource, so you can correct `datasource` and retry with the same mapping.

#### Example

`"Sales Extract"`

:::note
Datasource "the name you passed" is not a unique live datasource name or caption. Datasource "the name you passed" does not match the bound datasource "the datasource the mapping resolved to".
:::

<hr />

### `fieldMapping`

An object mapping each of the template's slot identifiers to the exact `column_ref` returned by field resolution. Between 1 and 32 entries; an empty mapping, or one over 32 entries, is refused before anything is read.

Field references are the fully qualified form the workbook uses, for example `[Sales Extract].[sum:Revenue:qk]`. A plainer field name or caption is also accepted, but only when it identifies exactly one field: a name that matches several is refused as ambiguous, with the qualified references it matched listed so you can pick one. Every mapping is checked against the schema of the workbook that was read, and any binding problem — a field the workbook does not contain, an ambiguous name, or a field whose role does not suit the slot it was mapped to — is reported per slot with nothing built.

#### Example

```json
{
  "fieldMapping": {
    "field_base_1": "[Sales Extract].[none:Segment:nk]",
    "field_base_2": "[Sales Extract].[sum:Revenue:qk]"
  }
}
```

:::note
fieldMapping must contain 1-32 template slot bindings.
:::

## Optional arguments

### `session`

The %product_name% session to build against, given as its process id. Omit it when the session is unambiguous — a pinned launching instance, or exactly one running instance. With two or more running and none pinned, the tool fails closed and lists the running session IDs rather than picking one.

#### Example

`"studio-1"`

<hr />

### `derivationOverrides`

Aggregation by slot.

:::note
An aggregation override for a slot cannot be honored when the binding emits a different aggregation than the one requested. The refusal names the requested aggregation, the slot, and the field reference the binding emits. Already aggregated fields retain their existing calculation. Drop the override to use that calculation, or bind a row-level field for the requested aggregation. No worksheet artifact was produced.

- `Aggregation override '${}' for slot '${}' cannot be honored: the binding emits '${}'. Already aggregated fields retain their existing calculation. Drop the override to use that calculation, or bind a row-level field for the requested aggregation. No worksheet artifact was produced.`
:::

### `topN`

Limit a simple ranked worksheet to its first N members before storing the artifact. `Range: 1-50`.

#### Example

```json
{ "topN": 10 }
```

:::note
If the named template is not a simple ranked worksheet that can take a Top-N filter, the build is refused and nothing is stored. topN could not be applied to template "the template name": the refusal includes the reason.
:::

## Notes and caveats

- **An artifact is single-use.** Applying it consumes it; the same `artifactId` cannot be applied twice. A second attempt reports that the artifact was already consumed and tells you to build a fresh one.
- **An artifact belongs to the session and instance it was built from.** Applying it from a different %product_name% session, or against a different running instance than the one that served the workbook read, is refused rather than applied to the wrong workbook.
- **Artifacts are held in memory by this MCP server and can be evicted.** The store holds a bounded number of artifacts; when it is full, the least recently used artifact that is not currently being applied is dropped to make room, and applying a dropped id reports that it was evicted. If every artifact is mid-apply, the build itself is refused with a capacity message asking you to apply or release one and retry. The refusal reads: Template artifact capacity is busy. Apply or release an in-use artifact, then retry. Build artifacts close to when you intend to apply them, rather than accumulating them.
- **The workbook must not drift between build and apply.** The artifact records the state of the workbook it was built over. If the workbook changed in the meantime, the apply step refuses instead of overwriting the newer work — rebuild the artifact against the current workbook and apply again.

## Example result

```json
{
  "artifactId": "8f1c2b90-3f5a-4a2e-9c7d-16a0b8e4f2d1",
  "templateName": "ranking-ordered-bar",
  "title": "Revenue by Segment",
  "datasource": "Sales Extract",
  "provenance": "protected",
  "bindings": [
    { "slotId": "field_base_1", "field": "[Sales Extract].[none:Segment:nk]" },
    { "slotId": "field_base_2", "field": "[Sales Extract].[sum:Revenue:qk]" }
  ]
}
```

## Related

- [`list-templates`](../binder/list-templates.md) — browse the templates and slots this tool builds from.
- [`apply-worksheet`](../worksheet/apply-worksheet.md) — apply a built artifact to the open workbook.
