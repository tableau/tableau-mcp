---
sidebar_position: 1
---

# List Datasources

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of published data sources from a Tableau site, with optional filtering via
`field:operator:value` expressions (e.g. `name:eq:Views`) for precise data source discovery.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

Talks to the **Tableau REST API** (Tableau Cloud or Server). The MCP-layer OAuth gate requires the
`tableau:mcp:datasource:read` scope; the REST call below requires `tableau:content:read`, plus
`tableau:mcp_site_settings:read` to read per-site MCP configuration overrides when
[MCP site settings](../../configuration/mcp-config/site-settings.md) are enabled.

- **Retrieve published data sources.** Lists the site's published data sources, applying the optional
  `filter`. The tool paginates automatically, repeatedly issuing the call until either all data
  sources are retrieved or the `limit` is reached.
  - `GET /api/{version}/sites/{siteId}/datasources` — query one page of the site's data sources.
    Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Data Sources filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#datasources).

Example: `name:eq:Project Views`

<hr />

### `pageNumber`

Which 1000-item page to fetch (1-based, default 1).

### `limit`
The maximum number of data sources to return. The tool will return at most this many data sources.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Notes and caveats

- Results may be narrowed by server-side [tool scoping](../../configuration/mcp-config/tool-scoping.md):
  when the deployment restricts the queryable data sources by project, data source, or tag, data
  sources outside that scope are removed from the response. If every data source found is filtered
  out this way, the tool reports that the allowed set is limited by the server configuration rather
  than returning an empty list without explanation.

## Example result

```json
[
  {
    "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45",
    "name": "Superstore Datasource",
    "description": "*Overview*: Superstore Datasource contains data about your profit and sales\n\n*What is a Row of Data?* Each row of data corresponds to a unique order.",
    "project": {
      "name": "Samples",
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
    }
  }
]
```

## Related

- [`query-datasource`](query-datasource.md) — run VizQL queries against a data source found here
- [`get-datasource-metadata`](get-datasource-metadata.md) — inspect a data source's fields before querying

{/* tool-details */}
## Worked example

The response fields are:

- `data`: the data sources on the requested page (at most 1000, or fewer when `limit` or a
  server cap applies).
- `totalAvailable`: the number of data sources available for pagination, never more than a server
  cap. Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides data sources:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.

## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all data sources are retrieved or the `limit` argument has been reached. The `pageSize`
argument will determine how many data sources to return in each call. You may want to provide a
larger value if you know in advance that you have more than 100 data sources to retrieve.

Example: `1000`

<hr />
{/* /tool-details */}
