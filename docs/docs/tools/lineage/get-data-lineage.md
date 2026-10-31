# Get Data Lineage

Trace data dependencies upstream or downstream from a database column, Tableau field, data source,
Prep flow, Prep input/output field, output step, or an internal Prep step/field. The tool is
read-only.

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

## Origins and parameters

| Source type                                                 | Required identity                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `column`                                                    | Opaque Metadata API `id`, or exact `name` and `table`, optionally `database` and `schema`        |
| `field`                                                     | Opaque Metadata API `id`                                                                         |
| `datasource`                                                | Published data source REST `luid`                                                                |
| `flow`                                                      | Flow REST `luid`                                                                                 |
| `flow-input-field`, `flow-output-field`, `flow-output-step` | Opaque Metadata API `id`                                                                         |
| `prep-step`                                                 | `flowLuid` and document `stepId`                                                                 |
| `prep-field`                                                | `flowLuid`, `stepId`, output field `name`; add `namespace` for a Group with several output ports |
| `local-flow`                                                | Absolute `.tfl`/`.tflx` `path`; optional `at` selects an exact local step or output field |

Metadata IDs, document step IDs and REST LUIDs are distinct namespaces. Returned graph `id` values
identify nodes in this response; use `metadataId`, `luid` or `stepId` for the corresponding source.

`direction` is `upstream`, `downstream` (default), or `both`. Optional Prep documents are requested
only when `includePrepDetails=true` or a `prep-step`/`prep-field` origin needs its document.

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
API for published flows. Local files use the bounded native package reader. The comparison does not establish every possible node type or
future release's format.

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

Omit `at` to inspect the whole saved file, or use `{"type":"step","stepId":"clean-step-id"}`
for step topology. A field origin refers to that step's output; supply `namespace` when it has
multiple output ports. A step topology link does not prove that every column is used by the step.

Only unchanged regular files within canonical configured roots are accepted. Network paths,
symlinks, hardlinks, unsupported archives and oversized input are rejected. Reads are bounded to
32 MiB per file and 16 MiB of native JSON, with bounded nested packages, counts and static analysis.
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
scripts and unverified model outputs remain gaps in `prepDetails.fieldAnalysis`.

Static document-field mappings and Metadata API identities are separate evidence sources. An exact
flow/output `stepId` can connect their content; unverified catalog output-field bindings are marked
`possible`. Equal field names across flows, branches or API namespaces are never a join key. Graph
nodes can include context; use the explicit `impacts` list from
[Analyze Data Impact](analyze-data-impact.md) when deciding which targets have a path from the
proposed change.

## Boundaries and limitations

Every returned content/field owner is checked against configured resource restrictions before it can
enter a result or path. Private parent references are projected away. External database columns have
no supported mapping to those restrictions, so column origins/nodes are excluded whenever a bounded
context is configured. Embedded fields require an allowed owning workbook and remain excluded under
a data-source-ID ceiling.

The published `flowFieldInputFieldsConnection` root and reverse field-input relationship do not
accept `permissionMode`. Such discovery results are never returned directly. Each input is
re-fetched through its owning Flow's `inputFieldsConnection` with `FILTER`, and its owners are
checked again before output. Unconfirmed inputs are omitted with a warning. When this exception is
used, `coverage.permissionMode` is `FILTER_WITH_VERIFIED_PREP_INPUTS`.

Metadata can be missing because of permissions, indexing delays, unsupported/custom SQL or API
availability. A missing or empty graph is **not evidence that a change is safe**. Coverage describes
the indexed, visible, bounded subgraph; it never claims an exhaustive inventory of the site.
