---
sidebar_position: 2
---

# List Destination Projects

Retrieves the projects on a Tableau site that the user can see as candidate destinations for
publishing or moving content. Each project is annotated with a `status` saying whether the user can
actually put the given content type there. Use this before
[Publish Workbook](../workbooks/publish-workbook.md) or
[Move Workbook](../workbooks/move-workbook.md) to choose a destination project the user is allowed
to use.

:::warning[Disabled by Default] This tool is gated behind the `destination-projects` feature flag,
which defaults to `false` in `features.json`. It is unavailable unless an administrator enables
`destination-projects`. See [Feature Flags](../../developers/feature-flags.md).

It also relies on an experimental Tableau REST API (`/api/exp`) that must be enabled on the Tableau
site. If it is not, the tool returns a "destination projects API is not enabled" error. Use
[List Projects](list-projects.md) instead in that case. :::

Related tools: [List Projects](list-projects.md)

Each call returns a single page of up to 1000 projects. The response is a flat object of the shape
`{ data, totalAvailable }` (see [Example result](#example-result)). To collect every project, start
at `pageNumber: 1` and increment `pageNumber` on each subsequent call until you have collected
`totalAvailable` items.

## Destination status

| Status                     | Meaning                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `VALID`                    | The user can publish or move the given content type into this project.                                            |
| `INSUFFICIENT_PERMISSIONS` | The user can see the project but lacks permission to publish or move content into it.                             |
| `STRUCTURALLY_INVALID`     | The project cannot hold the content for structural reasons, such as moving a project into itself or a descendant. |

The tool returns projects with every status, which keeps parent/child structure and `totalAvailable`
consistent. Offer only `VALID` projects as destinations.

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher
- **API scope**: `tableau:projects:read`

## APIs called

- Query Destination Projects (experimental): `GET /api/exp/sites/{siteId}/projects/destinations`

## Optional arguments

### `contentType`

The kind of content being published or moved. One of `workbook`, `datasource`, `flow`, or `project`.
Defaults to `workbook`.

Example: `datasource`

<hr />

### `sourceIds`

The IDs of existing content being moved (at most 100). When provided, destinations that would be
invalid for that content are marked `STRUCTURALLY_INVALID`. Omit this argument when publishing new
content.

Example: `["d00700fe-28a0-4ece-a7af-5543ddf38a82"]`

<hr />

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
using the same fields and operators as [List Projects](list-projects.md#filter). The tool validates
the expression before calling the REST API.

Example: `topLevelProject:eq:true`

<hr />

### `limit`

The maximum number of projects to return **from the requested page**. Must be a positive integer no
greater than 1000.

Example: `500`

<hr />

### `pageNumber`

Which 1000-item page of projects to fetch. This is a 1-based page index. When omitted, it defaults
to `1`. Pages beyond a configured
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) return an error
describing the valid page range.

Example: `2`

## Example result

```json
{
  "data": [
    {
      "id": "af59ee84-a375-4cb4-84b9-eaa7864f59fb",
      "name": "default",
      "description": "The default project that was automatically created by Tableau.",
      "topLevelProject": true,
      "isDefaultProject": true,
      "childProjectCount": 0,
      "status": "VALID",
      "createdAt": "2026-05-13T14:58:28Z",
      "updatedAt": "2026-05-13T14:58:28Z",
      "owner": {
        "id": "b4ffd9cf-6d7f-4a2f-a7a0-3bee3691ad36",
        "name": "admin"
      }
    },
    {
      "id": "986ed80f-0a39-4b8a-b5af-c8b3f1280ae7",
      "name": "Finance",
      "parentProjectId": "7de99ef3-0337-4959-8ffe-8d54fbb1f9aa",
      "topLevelProject": false,
      "isDefaultProject": false,
      "childProjectCount": 2,
      "status": "INSUFFICIENT_PERMISSIONS",
      "createdAt": "2026-05-13T15:23:00Z",
      "updatedAt": "2026-05-13T15:23:00Z",
      "owner": {
        "id": "86d935d7-d99c-46a1-8188-00faeee15465",
        "name": "jdoe"
      }
    }
  ],
  "totalAvailable": 2
}
```
