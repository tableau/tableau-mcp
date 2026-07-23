---
sidebar_position: 1
---

# List Projects

Retrieves a list of projects on a Tableau site, including metadata such as name, description, parent
project, content permissions, owner, and timestamps.

This tool returns a single page of up to 1000 projects per call. The response is a flat object
of the shape `{ data, totalAvailable }` (see [Example result](#example-result)). To collect
every project, start at `pageNumber: 1` and increment `pageNumber` on each subsequent call until
you have collected `totalAvailable` items.

To get the **count** of projects matching the request, read `totalAvailable` from a single call
(for example, `pageNumber: 1`) without paging through every item.

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

### `pageNumber`

Which 1000-item page of projects to fetch. This is a 1-based page index (page size is fixed at
1000); when omitted it defaults to `1`. Increment `pageNumber` across calls to page through the
full result set.

Example: `2`

<hr />

### `limit`

The maximum number of projects to return **from the requested page**. Must be a positive integer
no greater than 1000 (the fixed page size). Use this to fetch fewer than a full page — for
example, to request a partial final page. It does not fetch across pages.

Example: `500`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit),
the overall cap on how many results can be paginated through across all pages.

## Example result

```json
{
  "data": [
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
  ],
  "totalAvailable": 2
}
```

The response fields are:

- `data`: the projects on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of projects the client should paginate up to. This is
  `min(rawTotal, MAX_RESULT_LIMIT)` — equal to Tableau's raw total for the query when no
  server-side cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
  when one is in force. Your own `limit` argument does not affect this value.
