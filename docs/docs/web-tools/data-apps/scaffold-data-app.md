---
sidebar_position: 1
---

# Scaffold Data App

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Scaffolds a new Tableau data app workspace: a starter Tableau viz (worksheet) extension that queries a published datasource live through the Extensions API. The workspace holds a workbook plus an extension package with `index.html`, a `src/app.js` starter for your query and visualization, and a `manifest.json`. The tool only scaffolds and names the app. It does not wire a datasource, write query logic, build, publish, or embed data. For the Desktop tool of the same name, see [Scaffold a Desktop data app](../../desktop-tools/worksheet/scaffold-data-app.md).

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Reads the site's external allowed-origins list for extension packages. Requires the `tableau:packages:read` scope. A failed read is an error, not an empty list.
  - `GET /api/exp/sites/{siteId}/packages/allowed-origins`
- Returns the template zip: from S3 as a presigned URL when [`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket) is set, otherwise as a file path on the server.

## Required arguments

### `datappName`
Name for the new data app. Used verbatim as the workspace folder name, the workbook (`.twb`) file name, and the extension display name, and slugified into the extension package id.

1-100 characters: letters, digits, spaces, dot, underscore, or hyphen. It must start and end with a letter or digit and must not contain `..`.

#### Example

`"Sales Demo"`

{/* tool-details */}
## Derived values

From `datappName` the tool derives the following identity:

- **package id**: `com.tableau.mcp.<slug(datappName)>` — lowercase, non-alphanumeric runs collapsed
  to a single hyphen.
- **display name**: `datappName` verbatim.

- **version**: `1.0.0`.
- **author**: `Tableau MCP`.

The version and author are fixed defaults, not derived per call. All four values are placeholders
in the template (`TODO-MANIFEST-ID`, `TODO App Name`, `TODO-MANIFEST-VERSION`, `TODO Author Name`),
filled by the `postUnzip` edits in `data-app.trex` and `manifest.json` (the version also in the
`.twb`), so they always agree.

## Package manifest

The extension package ships a JSON manifest at `Packages/<package id>/manifest.json`. After the
`postUnzip` edits, its `id`, `version`, `name`, and `author` match `data-app.trex`:

```json
{
  "id": "com.tableau.mcp.sales-demo",
  "version": "1.0.0",
  "manifestVersion": "0.1",
  "name": "Sales Demo",
  "author": "Tableau MCP",
  "requestedOrigins": ""
}
```

`requestedOrigins` is always scaffolded empty. To let the app call external origins, set it to a
space-separated list of them, the same form as a Content-Security-Policy source list (for example
`"https://api.example.com https://cdn.example.com"`). Each one should also appear in the result's
`allowedOrigins`, the site's external origin allow-list. The result's `requestedOrigins` field
carries the finalized manifest's path and these same instructions.

## Response behavior

Every successful result includes `allowedOrigins`, an array of the site's configured external
origins. An empty array is a valid result; a failed lookup is an error, not an empty policy.

It also includes `requestedOrigins`: the path of the finalized `manifest.json` (relative to the
unzip directory, after `postUnzip`) and instructions for declaring the app's external origins in
it. See [Package manifest](#package-manifest).

The result is a single object. Both output modes return the same static, un-substituted template
zip plus a `postUnzip` plan describing the identity edits/renames to apply after unzipping — they
differ only in transport, never in when substitution happens (always client-side, after unzipping):

- **Otherwise (disk output)**: the result's `filePath` points at the template zip already on disk
  on the server — skip the download and unzip directly.

- **[`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket) configured (S3
  output)**: the server uploads its own build artifact — the same template zip disk output serves —
  to S3 automatically on every call, then presigns a short-lived GET URL for exactly those bytes.
  There is no manual publish step and nothing persists in the bucket waiting to be trusted; the
  object is always what the server just wrote. The result's `s3URL` points at the same
  un-substituted template — download it first, then unzip.

In both cases, `postUnzip` describes the literal find/replace edits and path renames to apply
after unzipping to finalize the workspace. Datasource wiring is never performed by this tool in
either mode — it is the caller's responsibility, applied to the finalized workbook after this tool
returns.

## Allow network egress to the download host

:::warning[Client configuration required]
In S3 output mode the agent downloads the template from `s3URL`, and it later uploads the workbook
the same way. If the agent runs in a sandbox with restricted network access, such as Claude's code
execution environment, allow the S3 host for your pod or the download fails. In Claude, go to
**Settings → Capabilities → Allow network egress** and add the host under **Additional allowed
domains**. See [Popular Client Integrations](../../hosted-tableau-mcp/client-integrations.md) for
client steps.
:::

## Example result (disk output)

```json
{
  "datappName": "Sales Demo",
  "filePath": "/app/build/templates/data-app-template.zip",
  "allowedOrigins": [],
  "requestedOrigins": {
    "file": "Sales Demo/Packages/com.tableau.mcp.sales-demo/manifest.json",
    "instructions": "`requestedOrigins` in this manifest is scaffolded empty. If the app fetches from external origins, set it to a space-separated list of them (e.g. \"https://api.example.com https://cdn.example.com\"). Each one should also be in `allowedOrigins`."
  },
  "postUnzip": {
    "instructions": "Finalize the workspace after unzipping: first apply every `edits` entry (a literal find/replace on the file at `file`), then apply `renames` in order. Every path is relative to the unzip directory.",
    "edits": [
      {
        "file": "Data App Name/Data App Name.twb",
        "replacements": [
          { "find": "TODO-MANIFEST-ID", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "TODO App Name", "replace": "Sales Demo" },
          { "find": "TODO Sheet Name", "replace": "Sales Demo" },
          { "find": "TODO-MANIFEST-VERSION", "replace": "1.0.0" }
        ]
      },
      {
        "file": "Data App Name/Packages/TODO-MANIFEST-ID/extensions/data-app.trex",
        "replacements": [
          { "find": "TODO-MANIFEST-ID", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "TODO App Name", "replace": "Sales Demo" },
          { "find": "TODO-MANIFEST-VERSION", "replace": "1.0.0" },
          { "find": "TODO Author Name", "replace": "Tableau MCP" }
        ]
      },
      {
        "file": "Data App Name/Packages/TODO-MANIFEST-ID/manifest.json",
        "replacements": [
          { "find": "TODO-MANIFEST-ID", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "TODO App Name", "replace": "Sales Demo" },
          { "find": "TODO-MANIFEST-VERSION", "replace": "1.0.0" },
          { "find": "TODO Author Name", "replace": "Tableau MCP" }
        ]
      }
    ],
    "renames": [
      { "from": "Data App Name/Packages/TODO-MANIFEST-ID", "to": "Data App Name/Packages/com.tableau.mcp.sales-demo" },
      { "from": "Data App Name/Data App Name.twb", "to": "Data App Name/Sales Demo.twb" },
      { "from": "Data App Name", "to": "Sales Demo" }
    ]
  }
}
```

## Example result (S3 output)

The S3 result has the same `requestedOrigins` and `postUnzip` as the disk output. Only the transport
field differs: `s3URL` replaces `filePath`.

```json
{
  "datappName": "Sales Demo",
  "s3URL": "https://example-bucket.s3.amazonaws.com/data-app-template.zip?X-Amz-Signature=...",
  "allowedOrigins": [],
  "requestedOrigins": { "file": "Sales Demo/Packages/com.tableau.mcp.sales-demo/manifest.json", "instructions": "..." },
  "postUnzip": { "instructions": "...", "edits": ["..."], "renames": ["..."] }
}
```
{/* /tool-details */}
