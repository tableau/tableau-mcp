## Worked example

The response fields are:

- `data`: the workbooks on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of workbooks available for pagination, never more than a server cap.
  Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides workbooks:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.

## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[Query Workbooks for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all workbooks are retrieved or the `limit` argument has been reached. The `pageSize` argument
determines how many workbooks to return in each call. You may want to provide a larger value if you
know in advance that you have more than 100 workbooks to retrieve.

Example: `1000`

<hr />
