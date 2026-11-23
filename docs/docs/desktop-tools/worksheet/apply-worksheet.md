---
sidebar_position: 2
---

# Apply Worksheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies a worksheet to the workbook currently open in %product_name%. A call uses exactly one of three modes:

- **Template-plan apply** — pass `templatePlan` with the exact template binding to build and apply in this call (_available September 2026 and later_). The plan is built and applied together, so there is no separate artifact to hold.
- **Artifact apply** — pass the `artifactId` of a worksheet already built by [`build-worksheets-from-templates`](../template/build-worksheets-from-templates.md). The artifact carries its own worksheet and title, so no name or file is involved.
- **Cached-file apply** — pass `worksheetFile` (and optionally `worksheetName`, inferred from a cached fragment when omitted). This is the "apply" leg of the manual worksheet edit loop: read structure with `get-xml`, edit the XML, then apply it here.

The three paths are mutually exclusive: combining `artifactId`, `templatePlan`, and a cached-file apply is refused before anything is applied.

:::warning[Destructive]
This tool is not read-only and not idempotent. It replaces a worksheet in the live %product_name% session with the content you supply, and each cached-file apply reads a new cache companion file.
:::

## APIs called

This tool acts on the worksheet in the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes** (there is no Tableau Cloud or Server sign-in): each call is authorized by the running %product_name% session's per-session bearer token over loopback. Which calls are made depends on the supply path: a cached-file apply replaces that one worksheet in place through its own document route, leaving the rest of the workbook untouched, while an artifact apply is a read-then-write against the whole open workbook, because the artifact carries a window definition alongside the sheet and anything omitted from a whole-document post would be pruned.

- Reads the worksheet content to apply.
  - Cached-file apply: the XML is read from the cached file path, after checking that the file was produced by the same %product_name% session. Local filesystem; no %ecapi_name% call.
  - Artifact apply: the worksheet is taken from the artifact this MCP server is holding. No %ecapi_name% call.
  - Template-plan apply: the worksheet is built in-process from `templatePlan` and then applied the same way as an artifact apply.
- Validates the worksheet XML and confirms its `<worksheet name>` matches the worksheet being targeted — validated in-process (not an %ecapi_name% call). Invalid XML never reaches %product_name%.
- Cached-file apply: resolves the named worksheet to the worksheet it will replace, then replaces it in place.
  - `GET /v<x>/workbook/worksheets` — list the open workbook's worksheets to resolve the target's id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `POST /v<x>/workbook/worksheets/{id}/document` (`Content-Type: application/xml`) — replace that worksheet from the posted fragment. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/applyWorksheetDocument)
- Artifact apply: reads the whole open workbook, confirms it has not changed since the artifact was built, splices the worksheet and its window in, re-validates the spliced document in-process, and re-posts the whole document.
  - `GET /v<x>/workbook/document` — read the current workbook XML to splice the change into. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - `POST /v<x>/workbook/document` (`Content-Type: application/xml`) — apply the updated workbook XML (the whole workbook is replaced, so the untouched sheets are re-posted as-is). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Re-reads the applied worksheet to verify the change actually landed (the readback that backs the host-verification receipt).
  - Cached-file apply: `GET /v<x>/workbook/worksheets`, then `GET /v<x>/workbook/worksheets/{id}/document` — re-read the applied worksheet to confirm. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - Artifact apply: `GET /v<x>/workbook/document` — re-read the workbook and pull the applied worksheet out of it. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)

## Optional arguments

Every argument is optional in the schema, but the three supply paths each have their own requirements: a template-plan apply needs `templatePlan`, an artifact apply needs `artifactId`, and a cached-file apply needs `worksheetFile` (`worksheetName` is optional and can be inferred from the cached fragment). A call that supplies none of those paths, or more than one, is refused.

### `artifactId`

Identifier of a prepared worksheet artifact held by this MCP server, as returned by [`build-worksheets-from-templates`](../template/build-worksheets-from-templates.md). Omit it for a direct template plan or a cached-file apply. Supplying it selects the artifact apply. Combined with `templatePlan` or `worksheetFile` the call is refused rather than guessing which content you meant; `worksheetName` may be passed with it and must equal the artifact title. Range: 1-255 characters.

#### Artifact availability

An artifact is single-use and belongs to the %product_name% session it was built from. The apply is refused, before anything reaches %product_name%, when the artifact is already being applied, was already consumed by an earlier apply, belongs to a different session, was dropped from the server's bounded artifact store, or is unknown; the error names which of those it was and, where a rebuild is the fix, says so. The apply is also refused when the open workbook changed after the artifact was built, rather than overwriting the newer work.

#### Example

`"8f1c2b90-3f5a-4a2e-9c7d-16a0b8e4f2d1"`

<hr />

### `templatePlan`

Exact template binding to build and apply in this call (_available September 2026 and later_). Supplying it selects the template-plan apply. It cannot be combined with `artifactId` or `worksheetFile`; `worksheetName` may be passed with it and must equal `templatePlan.title`. Nested fields:

- `templateName` — worksheet template id. Range: 1-128 characters.
- `title` — worksheet name to create. Range: 1-255 characters.
- `datasource` — live datasource name. Range: 1-255 characters.
- `fieldMapping` — object mapping each template slot id to a live field reference.
- `derivationOverrides` — optional object mapping a template slot id to a count derivation, `cnt` or `ctd`.

#### Example

```json
{
  "templatePlan": {
    "templateName": "bar-basic",
    "title": "Sales by Region",
    "datasource": "Orders",
    "fieldMapping": {
      "cat": "[Orders].[none:Region:nk]",
      "val": "[Orders].[sum:Sales:qk]"
    }
  }
}
```

:::note
Template "the template name" is not available. Template "the template name" could not be read. Template "the template name" is not eligible for worksheet template application. Template "the template name" did not produce a complete worksheet artifact. Datasource "the name you passed" is not a unique live datasource name or caption. Datasource "the name you passed" does not match the bound datasource "the datasource the mapping resolved to". fieldMapping must contain 1-32 template slot bindings. An aggregation override for a slot cannot be honored when the binding emits a different aggregation than the one requested. The refusal names the requested aggregation, the slot, and the field reference the binding emits. Already aggregated fields retain their existing calculation. Drop the override to use that calculation, or bind a row-level field for the requested aggregation. No worksheet artifact was produced. topN could not be applied to template "the template name": the refusal includes the reason.
:::

<hr />

### `worksheetName`

Existing worksheet id or name to update (_available September 2026 and later_ for matching by id). **Optional for a cached-file apply** — when omitted, the name is inferred from the cached fragment — and **optional for an artifact apply or a template-plan apply**, where it must match the artifact or plan title. When supplied, this must match the `name` attribute on the top-level `<worksheet>` element in the XML you supply. Range: 1-255 characters.

#### Name match gate

Before anything is sent to %product_name%, the caller's `worksheetName` must agree with the `<worksheet name>` in the authored XML (compared after trimming and Unicode normalization). On a mismatch the tool returns an actionable error naming both values instead of applying the wrong worksheet. A cached file holding a whole `<workbook>` document is also rejected here: this tool expects a single `<worksheet name="...">` fragment, and the error tells you how to pull that one element out of the file and splice your edit back into it.

#### Example

```json
{ "worksheetName": "Sales by Region" }
```

:::note
Provide exactly one apply mode: artifactId, templatePlan, or worksheetFile (worksheetName optional). worksheetName "the name you passed" must match artifact title "the artifact title". worksheetName "the name you passed" must match templatePlan.title "the plan title".
:::

<hr />

### `worksheetFile`

Filesystem path to the cached worksheet XML file on the local machine. **Required for a cached-file apply**: a call with no `artifactId`, no `templatePlan`, and no non-empty path is refused with an error telling you where to get one. **Omitted for an artifact apply or a template-plan apply.** The file must already exist; the tool returns an error if it is missing, and it must hold a single top-level `<worksheet name="...">` fragment beginning with an XML declaration or a tag. Get this path from `get-xml`, edit it with the cache read/write tools, then pass it here. Maximum 4096 characters.

#### Cache session guard

The file must carry a companion fingerprint matching the resolved %product_name% session. A cache produced by a different (or restarted) %product_name% instance is rejected before anything is applied, preventing cross-instance cache bleed.

:::note
The path must be a regular file inside the Desktop cache directory. A path outside that directory, or anything that is not a regular file, is refused as a security error and the apply does not run.
:::

#### Example

```json
{ "worksheetName": "Sales by Region", "worksheetFile": "/Users/me/.tableau-mcp/cache/worksheet-Sales_by_Region-abc123.xml" }
```

<hr />

### `session`
Identifier of the target %product_name% session, up to 64 characters. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

In a cached-file apply, the resolved session must match the session that produced the cache file; otherwise the apply is refused with a session-mismatch error. In an artifact apply, it must match the session the artifact was built from.

#### Example

`"12345"`

## Notes and caveats

- **A cached-file apply replaces, never creates.** The named worksheet must already exist in the open workbook. A name that resolves to no open worksheet is refused with a message pointing you at `get-sheets` to check the name, or at building the sheet from a template first. Applies are serialized against other sheet edits so the two cannot interleave.
- **Apply is verified by readback.** After applying, the tool re-reads the worksheet through the %ecapi_name% and compares intent-bearing structures against the XML you supplied. The success message carries a host-verification receipt: `verified` when the readback is clean, `unverified` when the worksheet could not be re-read, and a `failed` receipt when the readback proves %product_name% silently dropped or changed an intended structure. Non-fatal differences (for example, a sort %product_name% reshaped) ride along as warnings so you can re-check the rendered chart.
- **Load rejections surface verbatim.** When %product_name% accepts the request at the transport level but rejects the actual document load, the tool reports that failure text as-is rather than a success message.

## Example results

### Cached-file apply, readback clean

```json
{
  "message": "Successfully applied worksheet update for \"Sales by Region\". The worksheet has been updated.\n\nHOST VERIFICATION — verified: preflight clean · apply completed · readback clean. No host evidence of any workbook problem beyond the findings listed above — do not report unlisted issues.",
  "title": "Sales by Region",
  "applied": true,
  "retrySafe": false,
  "verification": { "ok": true, "status": "passed" }
}
```

### Cached-file apply, readback unavailable

```json
{
  "message": "Successfully applied worksheet update for \"Sales by Region\". The worksheet has been updated.\n\nHOST VERIFICATION — unverified: preflight clean · apply completed · readback unavailable. Do not claim the change is confirmed; report only the evidence above.",
  "title": "Sales by Region",
  "applied": true,
  "retrySafe": false,
  "verification": {
    "ok": true,
    "status": "skipped",
    "message": "Post-apply verification was unavailable."
  }
}
```

### Artifact apply

An artifact apply reports the artifact it consumed and the readback outcome instead of a message. `retrySafe` is always `false`: the artifact is spent, so recovery is to inspect the sheet and build a fresh one rather than to repeat the call.

```json
{
  "artifactId": "8f1c2b90-3f5a-4a2e-9c7d-16a0b8e4f2d1",
  "title": "Revenue by Segment",
  "applied": true,
  "retrySafe": false,
  "verification": { "ok": true, "status": "passed" }
}
```

## Related

- [`build-worksheets-from-templates`](../template/build-worksheets-from-templates.md) — builds the artifact that `artifactId` refers to.
- `get-xml` — reads worksheet structure and produces the cache file.
- [`sort-worksheet`](sort-worksheet.md) — applies or clears a native field sort without opening the sort dialog.
- [`refine-worksheet`](refine-worksheet.md) — bounded top-N / sort edits without manual XML surgery.
- [`apply-workbook`](../workbook/apply-workbook.md) — replaces the whole open workbook rather than a single worksheet.
