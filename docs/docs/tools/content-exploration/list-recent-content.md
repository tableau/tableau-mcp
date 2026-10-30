---
sidebar-position: 2
---

# List Recent Content

Lists the signed-in user's recently created, updated, or accessed views and workbooks on the current
Tableau site. Use this tool to revisit your own recent content, or use `search-content` for
relevance/popularity discovery and `list-views` / `list-workbooks` for general listings.

## API called

- [Get Recently Viewed for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_site.htm#get_recently_viewed_for_site)
  — `GET /api/{version}/sites/{siteId}/content/recent`, available in REST API 3.5 and later
- Existing view/workbook detail APIs when the server's bounded-context rules require them

JWT authorization requires `tableau:content:read`, supported for this endpoint from Tableau Cloud
API 3.16 and Tableau Server API 3.17. The MCP scope is `tableau:mcp:content:read`.

## Optional argument

### `limit`

An integer from 1 to 24. Default: 24. Limits apply **after** the server's existing resource-access
checks and preserve the mixed backend order. Configured
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) and
`MAX_RESULT_LIMITS` can further reduce the result. Denied rows never consume the limit.
Authorization probes stop as soon as the effective limit is filled; rows after that point are not
looked up merely to trim them from the response.

Example: `{ "limit": 5 }`

## Result

A JSON array of entries containing exactly one `view` or `workbook` metadata object. An empty array
is a successful response. Project, owner, and workbook references may contain only an `id`. Optional
metadata is returned only when Tableau supplies it. `createdAt` and `updatedAt` are content
creation/update times; they are not last-viewed or access timestamps.

```json
[
  {
    "view": {
      "id": "view-id",
      "name": "Overview",
      "contentUrl": "Superstore/sheets/Overview",
      "workbook": { "id": "workbook-id" },
      "project": { "id": "project-id" }
    }
  },
  {
    "workbook": {
      "id": "workbook-id",
      "name": "Superstore",
      "contentUrl": "Superstore",
      "project": { "id": "project-id" }
    }
  }
]
```

## Limitations

- Tableau returns a window of the user's latest 24 supported items. There is no pagination,
  arbitrary user selector, sorting, or date filtering. `limit` is a client-side response cap.
- Recent activity can take several minutes to appear. A smaller result may reflect permissions,
  resource restrictions, or the available recent window.
- Only views and workbooks are supported; this does not provide full Tableau UI Recents parity and
  does not include flows.
- The tool is read-only and does not modify content or recent history.
- The JSON `recents.recent` fixture contract follows Tableau's documented XML response and this
  SDK's JSON conventions. Live JSON response compatibility still requires validation on a site.
- Malformed or ambiguous resource rows fail the request without returning raw unfiltered rows.
