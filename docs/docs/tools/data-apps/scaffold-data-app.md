---
sidebar_position: 1
---

# Scaffold Data App

Scaffolds a new Tableau **data app** workspace: a starter Tableau viz (worksheet) extension that
queries a published datasource live via the Extensions API. Given a single `datappName`, the tool
derives the extension package id and display name and returns a ready-to-edit workspace — a
workbook plus an extension package containing `index.html` and a `src/app.js` starter you author
the query and visualization into, and a JSON `manifest.json` (see
[Package manifest](#package-manifest)).

This tool only **scaffolds and names** the app — it does not wire a datasource, author query
logic, build, publish, or embed data. Those remain separate steps.

:::warning[Disabled by Default]
This tool is gated behind the `data-apps` feature flag, which defaults to `false` in
`features.json`. It is unavailable unless an administrator enables `data-apps`. See
[Feature Flags](../../developers/feature-flags.md).
:::

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher
- **API scope**: `tableau:packages:read` is required. When API-scope enforcement is enabled,
  callers with older tokens missing this scope must reauthorize to request it.
- **Server feature**: The experimental packages API requires the Tableau `Packages` feature flag.

## APIs called

`GET /api/exp/sites/{siteId}/packages/allowed-origins` — reads the site's external origin policy.
This request is required and runs before the workspace is prepared or uploaded. If it fails,
the tool returns an error instead of a scaffolded workspace.

## Required arguments

### `datappName`

Name for the new data app. Used verbatim as the workbook (`.twb`) filename and the extension
display name, and slugified into the extension package id (`com.tableau.mcp.<slug>`). Letters,
digits, spaces, dot, underscore, and hyphen only; must start and end with a letter or digit; no
path separators or `..`; 1–100 characters.

Example: `Sales Demo` → package id `com.tableau.mcp.sales-demo`

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

It also includes `wiring`: the connection values for the Tableau site this session is signed in
to, which every published datasource wired into the app needs. They come from the server's own
configuration and the session's site, so no other tool call is needed to learn them.

- **`server`**: the Tableau host only, with no scheme or port (for example
  `10ax.online.tableau.com`).
- **`site`**: the site's content URL, which can differ from its display name. `""` for the Default
  site.
- **`channel`**: `https` or `http`, from the server URL.
- **`port`**: the server URL's port, or `443`/`80` when it uses the default for its channel.

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
returns, using the values in `wiring`.

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
  "wiring": {
    "server": "10ax.online.tableau.com",
    "site": "mcp-test",
    "channel": "https",
    "port": 443
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

```json
{
  "datappName": "Sales Demo",
  "s3URL": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "allowedOrigins": [],
  "requestedOrigins": {
    "file": "Sales Demo/Packages/com.tableau.mcp.sales-demo/manifest.json",
    "instructions": "`requestedOrigins` in this manifest is scaffolded empty. If the app fetches from external origins, set it to a space-separated list of them (e.g. \"https://api.example.com https://cdn.example.com\"). Each one should also be in `allowedOrigins`."
  },
  "wiring": {
    "server": "10ax.online.tableau.com",
    "site": "mcp-test",
    "channel": "https",
    "port": 443
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
