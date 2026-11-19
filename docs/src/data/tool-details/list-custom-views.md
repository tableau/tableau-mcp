## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[List Custom Views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all custom views are retrieved or the `limit` argument has been reached. The `pageSize`
argument will determine how many custom views to return in each call. You may want to provide a
larger value if you know in advance that you have more than 100 custom views to retrieve.

Example: `1000`

<hr />
