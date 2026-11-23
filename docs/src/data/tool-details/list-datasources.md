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
