---
sidebar_position: 1
---

# List Projects

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of projects on a Tableau site, including metadata such as name, description, parent
project, content permissions, owner, and timestamps. Supports optional `field:operator:value`
filtering for precise project discovery.


## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) to read the projects on the
site. The MCP-layer OAuth gate requires the `tableau:mcp:content:read` scope, which maps to the
`tableau:content:read` scope cited on the operation below, plus `tableau:mcp_site_settings:read` to
read per-site MCP configuration overrides when MCP site settings are enabled.

- **List the projects on the site.** Retrieves projects and their metadata, automatically paginating
  until all projects are retrieved or the `limit` is reached.
  - `GET /api/{version}/sites/{siteId}/projects` — query one page of projects per call. Issued
    against the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Projects filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#projects).

The tool validates the filter expression client-side against the documented allowed fields and
operators before calling the REST API. Invalid fields or operators are rejected up front instead of
surfacing as a REST API error.

**Supported filter fields and operators**

| Field             | Operators              |
| ----------------- | ---------------------- |
| `createdAt`       | `eq, gt, gte, lt, lte` |
| `name`            | `eq, in`               |
| `ownerDomain`     | `eq, in`               |
| `ownerEmail`      | `eq, in`               |
| `ownerName`       | `eq, in`               |
| `parentProjectId` | `eq, in`               |
| `topLevelProject` | `eq`                   |
| `updatedAt`       | `eq, gt, gte, lt, lte` |

Example: `name:eq:Default`

Example: `topLevelProject:eq:true`

Example: `parentProjectId:eq:abc-123`

Example: `updatedAt:gt:2023-01-01T00:00:00Z`

<hr />

### `pageSize`

The value of the `page-size` argument provided to the
[Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all projects are retrieved or the `limit` argument has been reached. The `pageSize` argument
will determine how many projects to return in each call. You may want to provide a larger value if
you know in advance that you have more than 100 projects to retrieve.

Example: `1000`

<hr />

### `limit`

The maximum number of projects to return. The tool will return at most this many projects.

Example: `500`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Example result

```json
[
  {
    "id": "af59ee84-a375-4cb4-84b9-eaa7864f59fb",
    "name": "default",
    "description": "The default project that was automatically created by Tableau.",
    "contentPermissions": "ManagedByOwner",
    "createdAt": "2026-05-13T14:58:28Z",
    "updatedAt": "2026-05-13T14:58:28Z",
    "owner": {
      "id": "b4ffd9cf-6d7f-4a2f-a7a0-3bee3691ad36"
    }
  },
  {
    "id": "986ed80f-0a39-4b8a-b5af-c8b3f1280ae7",
    "name": "Nested project 1",
    "description": "",
    "parentProjectId": "7de99ef3-0337-4959-8ffe-8d54fbb1f9aa",
    "contentPermissions": "ManagedByOwner",
    "createdAt": "2026-05-13T15:23:00Z",
    "updatedAt": "2026-05-13T15:23:00Z",
    "owner": {
      "id": "86d935d7-d99c-46a1-8188-00faeee15465"
    }
  }
]
```

{/* tool-details */}
## Worked example

The response fields are:

- `data`: the projects on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of projects available for pagination, never more than a server cap.
  Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides projects:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.
{/* /tool-details */}
