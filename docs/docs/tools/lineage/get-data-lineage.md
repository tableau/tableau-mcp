# Get Data Lineage

Trace data dependencies upstream or downstream from an external database/file/table, database
column, Workbook, published or embedded data source, Tableau field, Prep flow, worksheet, dashboard,
or an internal Prep step/field. The tool is read-only.

For example:

```json
{
  "source": {
    "type": "column",
    "database": "SalesDW",
    "schema": "dbo",
    "table": "orders",
    "name": "sales_amount"
  },
  "direction": "downstream",
  "includePrepDetails": true,
  "maxDepth": 8
}
```

Names must match exactly. If multiple columns match, the result is `ambiguous` and provides
candidates with their Metadata API IDs and table qualifications. It never chooses the first match.

## Investigate a field from origin through processing to its users

To answer "Where does this field come from, how is it processed through Prep, and which data
sources, flows and workbooks use it?", resolve the field's exact Metadata ID from its owning data
source, then request both directions and optional Prep details:

```json
{
  "source": { "type": "field", "id": "opaque-metadata-field-id" },
  "direction": "both",
  "includePrepDetails": true,
  "maxDepth": 12
}
```

Follow upstream graph edges to source columns/tables/files and Prep input/output fields; follow
downstream edges to published/embedded data sources, later flows, worksheets, dashboards and owning
workbooks. Flow LUIDs identify the Prep context. For native processing, inspect supported
`prep-field` versions and the matching operation `documentPath`/`path`, references, expressions and
output names. Use `analyze-data-impact` for a proposed change and its representative downstream
evidence paths.

An operation list describes the owning Flow document, not proof that every listed operation uses the
selected field. A confirmed field path requires supported reference/mapping edges. If a catalog
field cannot be bound to a document field, show the processing context and the unresolved handoff
separately; do not join them by a matching name. Keep `possible`/`unknown` evidence, coverage limits
and missing permissions visible in the answer.

## Saved Prep fields and observed schemas

Saved input unions follow their `generatedInputs`, member actions and explicit column mappings. A
complete current schema can resolve supported wildcard unpivot membership. Quick date calculations
create derived fields; multi-row calculations also depend on their saved partition, order, rank and
compute columns. Prediction edges describe the saved model input mappings, not model execution.

Catalog handoffs require an exact native `fieldId`, an authorized owning Flow and, for an output,
the exact output step. Observed Cloud node-scoped field IDs are resolved only when the outer scope
repeats the native origin or matches that output step; arbitrary UUID prefixes are refused. Captions
and field order are never identity evidence. Inspect `prepDetails[].fieldAnalysis.catalogBindings`
for confirmed and unresolved counts/reasons.

For input or script output schemas that are absent from the document, the optional
`observedPrepSchemas` argument accepts `{documentSha256, nodeId, fields: [{name, type}]}` records.
Use `fieldAnalysis.schemaRequirements.documentSha256` and its node identities from a first call.
Only current operator-observed names and physical types are accepted; changed document content,
duplicate fields and extra properties are rejected. The limits are 100 observations and 5,000 fields
in total. Observations require the same document access as other Prep details.

An observed script output is a creation boundary: downstream use can be traced, while arbitrary
Python/R input-to-output logic still needs external dependency evidence. An output schema alone
cannot prove that logic, and the tools execute no scripts or models. Future runtime column changes,
missing saved members, unsupported versions and ambiguous native identifiers remain explicit.

## Content and external-asset usage

External assets follow the
[Tableau Catalog model](https://help.tableau.com/current/online/en-us/dm_perms_assets.htm):
databases include files, and tables include table-like objects. Use `database` with the Metadata ID
of a `File`/`CloudFile` for a CSV/XLSX or other indexed file asset; this does not read the file or
its connection settings. The returned `metadataType` distinguishes its concrete type.

For a Workbook's inputs and contained visualizations:

```json
{
  "source": { "type": "workbook", "luid": "11111111-1111-4111-8111-111111111111" },
  "direction": "both",
  "includePrepDetails": true
}
```

For an external table's use in Prep, data sources and dashboards:

```json
{
  "source": { "type": "table", "id": "opaque-metadata-table-id" },
  "direction": "downstream"
}
```

Workbook inputs connect through embedded/published data sources, upstream Prep and external
tables/databases. Prep input/output fields and catalog content rollups expose upstream producers and
downstream users. Upstream and downstream walks remain separate even with `both`: an upstream shared
data source or containing table never sends that walk into its other users or sibling columns.
Workbook members are terminal impact targets; a column-to-Workbook containment edge cannot fan out
to unrelated views.

Content rollups remain `possible` evidence. They can identify use of an asset without proving a
particular column mapping or reconstructing every intermediate hop. A Workbook as a whole has its
contained sheets/dashboards as downstream targets; its upstream data sources are not downstream
impacts.

## Origins and parameters

| Source type                                                 | Required identity                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `database`                                                  | Opaque Metadata API `id`; includes `DatabaseServer`, `File` and `CloudFile` assets               |
| `table`                                                     | Opaque Metadata API `id`, including database tables and indexed custom SQL tables                |
| `workbook`                                                  | Workbook REST `luid` or opaque Metadata API `id`                                                 |
| `sheet`, `dashboard`                                        | Opaque Metadata API `id`                                                                         |
| `column`                                                    | Opaque Metadata API `id`, or exact `name` and `table`, optionally `database` and `schema`        |
| `field`                                                     | Opaque Metadata API `id`                                                                         |
| `datasource`                                                | Published data source REST `luid`, or published/embedded Metadata API `id`                       |
| `flow`                                                      | Flow REST `luid`                                                                                 |
| `flow-input-field`, `flow-output-field`, `flow-output-step` | Opaque Metadata API `id`                                                                         |
| `prep-step`                                                 | `flowLuid` and document `stepId`                                                                 |
| `prep-field`                                                | `flowLuid`, `stepId`, output field `name`; add `namespace` for a Group with several output ports |
| `local-flow`                                                | Absolute `.tfl`/`.tflx` `path`; optional `at` selects an exact local step or output field        |

Metadata IDs, document step IDs and REST LUIDs are distinct namespaces. Returned graph `id` values
identify nodes in this response; use `metadataId`, `luid` or `stepId` for the corresponding source.

`direction` is `upstream`, `downstream` (default), or `both`. Optional Prep documents are requested
when `includePrepDetails=true`, a `prep-step`/`prep-field` origin needs its document, or
`observedPrepSchemas` is supplied. The same download permission checks apply.

| Limit                                                      | Default | Maximum |
| ---------------------------------------------------------- | ------: | ------: |
| `maxDepth` (Metadata traversal)                            |       5 |      12 |
| `maxNodes` (returned graph, including Prep field versions) |     100 |     500 |
| `maxEdges`                                                 |     300 |    2000 |
| `maxRequests` (Metadata and document requests)             |      40 |     200 |
| `pageSize`                                                 |      25 |     100 |

Resource authorization checks may make additional REST calls. Source lookup and relationship
connections are paginated within the request budget. Limits, non-advancing cursors, partial GraphQL
responses and unavailable relationships produce explicit warnings. Static document analysis also has
bounded node, recursion, field-version and dependency limits.

## Requirements

The caller needs Explorer or a higher site role and, when MCP OAuth scope enforcement is enabled,
`tableau:mcp:lineage:read`. The Metadata API must be enabled and indexed. Catalog calls use
`tableau:content:read`; resource checks also require `tableau:mcp_site_settings:read` and, when Prep
reads are enabled, `tableau:flows:read`.

Prep catalog access follows `FLOW_READ_TOOLS_ENABLED` / `flow-read-tools`. Optional internal details
use the same sanitized endpoint as [Describe Flow](../flows/describe-flow.md):

```text
GET /api/exp/sites/{siteId}/flows/{flowId}/document
```

Documents require a supported2026.3+ deployment, flow download permission and
`tableau:flows:download`. Published Server requirements also name `features.getFlowDocumentRestApi`.
On self-managed Tableau Server an administrator enables it with:

```bash
tsm configuration set -k features.getFlowDocumentRestApi -v true --force-keys
tsm pending-changes apply
```

Applying pending changes may restart Server. These MCP tools never change deployment settings. A
Cloud2026.3.2 probe returned HTTP200 without changing settings; this establishes availability on
that deployment, not the flag value or universal Cloud support. Error403201 identifies a disabled
experimental API; other403 responses remain permission/scope/availability failures. Catalog lineage
is retained when an optional document cannot be read. Internal step/field origins remain unavailable
without their document.

An exhaustive comparison of one19-root-node flow visited2675 native JSON paths and3123 API paths,
including nested node objects and arrays. All2672 shared paths had equal types and scalar values;
all18 saved expression strings matched. The only native-only properties were three
`nodes/<node>/relation/displayName` paths. The API added451 paths, including field
`isGenerated`/`prettifiedName` metadata. The user accepted those three display-name omissions
because this read-only lineage analyzer does not consume them. Full JSON equality is not claimed.

The API object corresponds to the native `flow` document, not a package-reader envelope containing
`flow`, `displaySettings` and `maestroMetadata`. Unknown API formats produce
`PREP_DOCUMENT_FORMAT_UNSUPPORTED`; wrappers are not guessed. This implementation uses Flow Document
API for published flows. Local files use the bounded native package reader. The comparison does not
establish every possible node type or future release's format.

## Local TFL and TFLX files

Self-hosted stdio operators can opt in with `LOCAL_FLOW_ROOTS`, a JSON array of absolute directories
(at most 20). For example, set it to `["C:/Prep/flows"]` or `["/home/me/prep-flows"]` in the MCP
process environment. It defaults to `[]`. HTTP transport cannot read local flow files. Tableau
server/auth configuration is still required to start the existing web MCP server.

```json
{
  "source": {
    "type": "local-flow",
    "path": "C:/Prep/flows/sales.tflx",
    "at": { "type": "field", "stepId": "clean-step-id", "name": "Amount" }
  },
  "direction": "downstream"
}
```

Omit `at` to inspect the whole saved file, or use `{"type":"step","stepId":"clean-step-id"}` for
step topology. A field origin refers to that step's output; supply `namespace` when it has multiple
output ports. A step topology link does not prove that every column is used by the step.

Only unchanged regular files within canonical configured roots are accepted. Network paths,
symlinks, hardlinks, unsupported archives and oversized input are rejected. Reads are bounded to 32
MiB per file and 16 MiB of native JSON, with bounded nested packages, counts and static analysis.
Archives are inspected in memory without extracting embedded data or writing the source. File
fingerprints namespace local graph identities; an embedded ID or matching name does not establish
identity with a published flow.

Local responses set `coverage.metadata=not-requested`, `coverage.permissionMode=NOT_REQUESTED` and
zero request count. They return saved static dependencies and an explicit publication warning.
Remote resource restrictions apply to catalog calls; local file access is governed separately by
transport and operator roots. No Tableau, database, Python/R, model, publish or flow-run request is
made. Published downstream impact requires a separately verified published origin.

## Results and Prep coverage

The result includes `resolution`, `sourceId`, `nodes`, `edges`, `coverage`, `warnings` and
`limitations`. Edges retain their API relationship name and provenance. Direct reference edges are
distinguished from transitive catalog rollups (`possible`). Container membership is terminal so that
one field does not make every unrelated field in its data source or workbook an impact.

`prepDetails` contains allowlisted operation details, including nested `loomContainer.nodes`,
`actionNode`, ordered actions and before/after annotations. Supported details include expressions,
filter references, Join conditions, aggregation/grouping settings and renames. Downloaded files may
contain private connection data or embedded rows. Connection attributes, script bodies, row data,
original archive bytes and raw JSON are never returned or written to disk.

Static field versions follow 94 exact inventoried node types in 20 effect families: input/output,
containers/Groups, calculations and overwrites, single/bulk renames, removals/keep, merge,
aggregate, Join namespaces and suffixes, Union mappings, both Pivot directions, row generation,
value/type changes and explicit external/unknown boundaries. These rules analyze saved JSON; they do
not run Prep or evaluate expressions. Unknown type versions never inherit a rule just because their
suffix looks familiar. Dynamic schemas, unsupported expressions, ambiguous ports/names, external
script dependencies and missing model input mappings remain gaps in `prepDetails.fieldAnalysis`.

Static document-field mappings and Metadata API identities are separate evidence sources. An exact
native `fieldId` plus owning Flow/output `stepId` can establish a column handoff; unmatched output
bindings are marked `possible`. Equal field names across flows, branches or API namespaces are never
a join key. Graph nodes can include context; use the explicit `impacts` list from
[Analyze Data Impact](analyze-data-impact.md) when deciding which targets have a path from the
proposed change.

`prepDetails.fieldAnalysis.catalogBindings.unresolvedReasons` distinguishes
`native-input-field-absent-from-saved-schema`: the catalog's exact input-node identity names a field
absent from that node's resolved saved schema. Check saved-reference issues and reconcile the source
schema or flow definition before completing the field journey. No missing field version is
fabricated; unavailable schemas retain the generic unresolved-identity reason.

## Boundaries and limitations

Every returned content/field owner is checked against configured resource restrictions before it can
enter a result or path. Private parent references are projected away. External
databases/files/tables/columns have no supported mapping to those restrictions, so these
origins/nodes are excluded whenever a bounded context is configured. Embedded fields require an
allowed owning workbook and remain excluded under a data-source-ID ceiling.

The published `flowFieldInputFieldsConnection` root and reverse field-input relationship do not
accept `permissionMode`. Such discovery results are never returned directly. Each input is
re-fetched through its owning Flow's `inputFieldsConnection` with `FILTER_RESULTS`, and its owners
are checked again before output. Unconfirmed inputs are omitted with a warning. When this exception
is used, `coverage.permissionMode` is `FILTER_WITH_VERIFIED_PREP_INPUTS`.

Metadata can be missing because of permissions, indexing delays, unsupported/custom SQL or API
availability. A missing or empty graph is **not evidence that a change is safe**. Coverage describes
the indexed, visible, bounded subgraph; it never claims an exhaustive inventory of the site.
