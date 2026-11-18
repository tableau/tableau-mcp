## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)

## Embedded (workbook) data sources

Besides published data sources, this tool can fetch metadata for a data source embedded in a
workbook — pass the embedded data source's `datasourceLuid` (e.g. a connection's datasource ID from
[Get Workbook](../workbooks/get-workbook.md)). A few caveats apply:

- **Site opt-in:** a site administrator must enable querying of workbook (embedded) data sources on
  the Tableau site, otherwise the request returns a "not enabled" error.
- **Permissions:** an embedded data source has no permissions of its own — it inherits those of its
  containing workbook, so you need view/query access to that workbook.
  [Get Workbook](../workbooks/get-workbook.md) reports this up front as
  `queryability.isQueryable`.
- **Version:** requires Tableau 2026.3+ (REST API 3.30 or later); published data sources are
  unaffected.
- **Tool scoping:** when [tool scoping](../../configuration/mcp-config/tool-scoping.md) limits which workbooks are visible, the workbook that contains the embedded data source has to be included.

## Optional field selectors

- `fieldNames`: a nonempty array of exact, case-sensitive **field captions**. All duplicate-caption
  matches are returned. These are captions, not VDS internal field names.
- `search`: a nonblank, case-insensitive substring of a field's caption or description. Leading and
  trailing whitespace is trimmed. With `fieldNames`, both conditions must match.

For example, use `fieldNames: ["Sales", "Order Date"]` for known fields, or `search: "revenue"` to
discover fields whose captions or descriptions contain that text. Selected fields retain their full
metadata, including formulas and descriptions. Empty field groups are omitted.

Search is literal, so related fields and formula dependencies may not match. For broad discovery
or uncertain terminology, omit selectors; fetch referenced fields when needed.

When either selector is supplied, `mcp.resultInfo` reports `totalFields` before selection,
`matchedFields` after both selectors, and `unknownFieldNames` for requested captions absent from the
datasource. A known caption excluded by `search` is not an unknown name. No matches produces empty
`fieldGroups`.

Selectors only affect fields. Parameters, datasource descriptions and model relationships are
returned unchanged. Filtering happens after upstream metadata is fetched; it reduces tool output,
not upstream requests. There is no response-size cap. Omit both selectors for the existing full
response without `mcp.resultInfo`.

## Response shape

1. `datasourceDescription`
2. `datasourceModel` (optional)
3. `fieldGroups`
4. `parameters`
5. `mcp` (only when a field selector is supplied)

`datasourceModel` is available on Tableau versions that support the VDS `get-datasource-model`
endpoint (2025.3+). On older versions, it is omitted.

Fields expose their display caption as `name` and, when available from VDS, their underlying query
name as `fieldName`. Parameters similarly expose `name` and optional `parameterName`. If captions
repeat across logical tables, choose the intended table and use its exact query names with
[`query-datasource`](./query-datasource.md) on Tableau 2025.3+.
Metadata API-only fallback results do not include underlying query names.
