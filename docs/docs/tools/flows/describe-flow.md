---
sidebar_position: 3
---

# Describe Flow

Explains what a Tableau Prep flow actually **does** by reading and summarizing the flow's underlying
document (the design of the flow itself, not just its catalog metadata). Use this when a
user asks "what does this flow do?", "where does this flow get its data?", "what does it output?",
or "walk me through this flow".

## Describe Flow vs Get Flow

- [Get Flow](get-flow.md) returns catalog **metadata** — name, owner, project, tags, output step
  names, input connections, recent run history. Use it for "who owns this?" or "did the last run
  succeed?".
- **Describe Flow** returns a structured view of the flow's **internal design** — its inputs, outputs,
  steps, lineage, and connections. Use it to understand the flow's purpose and how data moves through
  it.

## APIs called

- `GET /api/exp/sites/{siteId}/flows/{flowId}/document` — an **experimental** Tableau REST API that
  returns the flow's sanitized document as JSON.
- [Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
  — used to enrich the summary with the flow's identity (name, owner, project, tags, parameters).
  Best-effort: if it fails, the structural summary is still returned with a note.

## Requirements

This feature requires **Tableau Server 2026.3 or later** and the server feature flag
`features.getFlowDocumentRestApi` enabled. On an older server, use [Get Flow](get-flow.md) for
metadata or upgrade Tableau Server.

The flow-document endpoint lives under `/api/exp` and is experimental. A server administrator can
enable the feature flag with TSM:

```bash
tsm configuration set -k features.getFlowDocumentRestApi -v true --force-keys
tsm pending-changes apply
```

Applying pending changes may restart Tableau Server.

:::warning[Experimental API]

Because this API is experimental, its availability and response format may change between Tableau
Server releases.

:::

## Data safety

The document is fetched through a server-side **sanitized** endpoint: connection credentials,
secrets, and email-shaped PII are redacted before the document leaves Tableau. This tool surfaces
only structural/topology fields (step types, connection servers/databases/files, lineage) and never
returns passwords or tokens.

## Required Tableau API scopes

When the MCP server authenticates with OAuth (connected-app JWT), this tool requests:

- `tableau:flows:read` — resolves the flow's identity (name / project / owner) for the summary.
- `tableau:flows:download` — authorizes the experimental document endpoint.
- `tableau:mcp_site_settings:read`

Flows use the dedicated `tableau:flows:*` scopes, not the `tableau:content:read` scope used by
workbooks, data sources, and views. See
[OAuth configuration](../../configuration/mcp-config/oauth.md) for details.

## Caller-role visibility

The document download applies the same permission as downloading the flow file in the Tableau web
UI. Server / site administrators can describe any flow on the site; non-admin callers can describe
only flows they are allowed to download. When the MCP server is configured with a bounded context
(`PROJECT_IDS` / `TAGS`), flows outside the allowed set are rejected before any document is fetched.

## Required arguments

### `flowId`

The LUID of the flow, typically retrieved from the [List Flows](list-flows.md) tool.

Example: `d00700fe-28a0-4ece-a7af-5543ddf38a82`

## Optional arguments

### `includeFieldSchemas`

When `true`, additionally returns a `fields` map of per-step column lists (`{name, type}`). This is
verbose, so it defaults to `false` — request it only when the user asks about specific columns or
schema. Default: `false`.

## Response shape

A compact, structured summary (not the raw document):

| Field          | Description                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `flow`         | Identity — `id`, `name`, `description`, `project`, `owner`, `fileType`, `updatedAt`, `webpageUrl`, `tags`. |
| `stats`        | Counts — `nodeCount`, `inputCount`, `outputCount`, `transformCount`, `connectionCount`.                    |
| `inputs`       | Each input step with a human-readable `role` and, where available, its resolved `connection`.              |
| `outputs`      | Each output/write step with a `role` and any recognizable `target` details.                                |
| `steps`        | The transformation steps (joins, aggregates, filters, calculations, pivots, …), each with a `role`.        |
| `lineage`      | Directed `{from, to}` edges (by step name) describing how data flows step-to-step.                         |
| `connections`  | The de-duplicated list of all data connections referenced by the flow.                                     |
| `parameters`   | The flow's parameters (`name`, `type`, `value`).                                                           |
| `fields`       | Only when `includeFieldSchemas: true` — per-step column lists.                                             |
| `mcp.warnings` | Only when present — structured, non-fatal warnings (see [Partial failure](#partial-failure-mcpwarnings)).  |

## Partial failure (`mcp.warnings`)

The primary call — downloading the flow document — is atomic: if it fails, the tool returns an error
(see [Errors](#errors) below). Everything else is best-effort, so when a non-fatal problem occurs
the tool still returns the structural summary and surfaces a structured warning under `mcp.warnings`
instead of failing the whole call. This mirrors the `mcp.warnings` shape used by
[Get Flow](get-flow.md#partial-failure-mcpwarnings) so both flow tools report partial failures the
same way. Two warning types can appear:

### `METADATA_FETCH_FAILED`

Emitted when the best-effort [Query Flow](get-flow.md) enrichment call fails. The identity fields
under `flow` (name, owner, project, tags) may be missing, but the structural summary derived from
the document is still valid.

```json
{
  "type": "METADATA_FETCH_FAILED",
  "severity": "WARNING",
  "message": "Could not load flow metadata (name/owner/project): HTTP 403 Forbidden. The structural summary below is derived from the flow document only.",
  "affectedField": "flow",
  "httpStatus": "403"
}
```

### `EMPTY_DOCUMENT`

Emitted when the document was downloaded and parsed but contained no recognizable steps. The flow
may genuinely be empty, or the experimental document format may have changed.

```json
{
  "type": "EMPTY_DOCUMENT",
  "severity": "WARNING",
  "message": "The flow document contained no recognizable steps. It may be empty, or the experimental document format may have changed.",
  "affectedField": "steps"
}
```

## Errors

- **Experimental API not enabled** (HTTP 403, Tableau error code `403201`): the experimental
  flow-document API is disabled. Confirm the server is Tableau Server 2026.3 or later and that
  `features.getFlowDocumentRestApi` is enabled and its pending TSM changes have been applied. Use
  [Get Flow](get-flow.md) for metadata instead.
- **Unsupported server version**: `describe-flow` requires Tableau Server 2026.3 or later. Upgrade
  Tableau Server; [Get Flow](get-flow.md) remains available for metadata.
- **Not authorized to download** (HTTP 403, any other code): the caller lacks permission to download
  this flow (the same permission as downloading its `.tfl`/`.tflx` file in Tableau), or the token
  lacks the `tableau:flows:download` scope. This is reported separately from the not-enabled case
  so a permission problem is never misread as a disabled API. Confirm you can download the flow in
  Tableau, or use [Get Flow](get-flow.md) for metadata that does not require download permission.
- **No flow document available** (HTTP 404): the flow id is unknown, not visible to the caller, or
  has no stored document (for example a metadata-only seeded flow). Use [List Flows](list-flows.md)
  to find a valid flow id.

## Limitations

- Relies on an experimental Tableau REST API that may change. It requires Tableau Server 2026.3 or
  later and the `features.getFlowDocumentRestApi` server flag to be enabled.
- The summary is derived from the flow document's structure. Highly customized or future node types
  that the summarizer does not recognize are still listed, with a humanized label derived from their
  raw type, but without a curated friendly role.
- Row-level transformation logic (e.g. the exact calculation expression or filter predicate) is not
  extracted; the tool reports the **kind** of each step and the flow's shape, not its full formula
  text.

## Example result

```json
{
  "flow": {
    "id": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
    "name": "Sales Cleanup",
    "description": "Cleans up the daily sales feed",
    "project": "Finance",
    "owner": "Dana Owner",
    "fileType": "tflx",
    "updatedAt": "2024-11-06T21:31:00Z",
    "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/flows/3",
    "tags": ["sales", "daily"]
  },
  "stats": {
    "nodeCount": 6,
    "inputCount": 2,
    "outputCount": 1,
    "transformCount": 3,
    "connectionCount": 2
  },
  "inputs": [
    {
      "nodeId": "n-input-csv",
      "name": "Orders.csv",
      "nodeType": "LoadCsv",
      "role": "Input — CSV file",
      "connection": { "id": "c-csv", "type": "textscan", "file": "Orders.csv", "isPackaged": true }
    },
    {
      "nodeId": "n-input-sql",
      "name": "Customers",
      "nodeType": "LoadSql",
      "role": "Input — database query",
      "connection": {
        "id": "c-sql",
        "type": "sqlserver",
        "server": "sql.internal.example.com",
        "database": "SalesDW",
        "schema": "dbo",
        "isPackaged": false
      }
    }
  ],
  "outputs": [
    {
      "nodeId": "n-output",
      "name": "Sales Mart",
      "nodeType": "PublishExtract",
      "role": "Output — published data source / extract",
      "target": { "datasourceName": "Sales Mart", "projectName": "Finance" }
    }
  ],
  "steps": [
    { "nodeId": "n-join", "name": "Join Orders + Customers", "nodeType": "Join", "role": "Join" },
    { "nodeId": "n-filter", "name": "Keep 2024", "nodeType": "Filter", "role": "Filter rows" },
    {
      "nodeId": "n-calc",
      "name": "Profit Ratio",
      "nodeType": "AddColumn",
      "role": "Add column (calculation)"
    }
  ],
  "lineage": [
    { "from": "Orders.csv", "to": "Join Orders + Customers" },
    { "from": "Customers", "to": "Join Orders + Customers" },
    { "from": "Join Orders + Customers", "to": "Keep 2024" },
    { "from": "Keep 2024", "to": "Profit Ratio" },
    { "from": "Profit Ratio", "to": "Sales Mart" }
  ],
  "connections": [
    { "id": "c-csv", "type": "textscan", "file": "Orders.csv", "isPackaged": true },
    {
      "id": "c-sql",
      "type": "sqlserver",
      "server": "sql.internal.example.com",
      "database": "SalesDW",
      "schema": "dbo",
      "isPackaged": false
    }
  ],
  "parameters": [{ "name": "Region", "type": "string", "value": "West" }]
}
```
