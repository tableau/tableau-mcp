---
sidebar_position: 1
---

# List Projects

Retrieves a list of projects on a Tableau site, including metadata such as name, description, parent
project, content permissions, owner, and timestamps.

## APIs called

- [Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)

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
