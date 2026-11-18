## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)

  When set, the tool skips the Metadata API lineage-enrichment call and `upstreamDatasources` is
  omitted from `workbook`/`view` results.

## Worked example

`workbook` and `view` results may also include an `upstreamDatasources` array (each entry
`{ "luid": "...", "name": "..." }`) when lineage enrichment succeeds — see [APIs called](#apis-called).
