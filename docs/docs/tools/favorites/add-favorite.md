---
sidebar_position: 2
---

# Add Favorite

`add-favorite` adds an accessible content item to the authenticated user's shortlist. Re-adding an
item with the same label has no effect; a different label replaces its favorite label. Tableau may
reject duplicate workbook labels. This does not change the content itself or its permissions.

## Required arguments

- `resourceType`: `workbook`, `view`, `datasource`, or `project`.
- `resourceId`: the target Tableau LUID, in UUID format.
- `label`: nonblank string; Unicode is preserved. Leading/trailing nonblank text is not rewritten.

There is no user selector. Even an administrator cannot use this tool to alter another user's
favorites. Identity resolution and all supported-content boundary rules are described in
[List Favorites](list-favorites.md). A denied target is rejected before the membership mutation.
Access preflight sessions finish before the tool opens its mutation session. This avoids invalidating
the mutation's PAT session: [Tableau Cloud permits only one concurrent session per PAT](https://help.tableau.com/current/online/en-us/security_personal_access_tokens.htm).
Self identity is still verified on the mutation connection before writing; all probes use the same
authenticated request configuration and bounded-context restrictions.

## API called

[Add favorites](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm):
`PUT /api/{version}/sites/{siteId}/favorites/{authenticatedUserId}` with exactly one typed target:

```json
{
  "favorite": {
    "label": "Regional Sales",
    "workbook": { "id": "11111111-1111-4111-8111-111111111111" }
  }
}
```

The API returns HTTP 200 with a favorites-list envelope. The tool discards that full response to
avoid exposing unrelated or out-of-bound favorites. It returns only the requested `resourceType`,
`resourceId`, and `label` after success. HTTP and route-safety errors are preserved. If response
validation fails, the safe error warns that the membership mutation may already have occurred;
check the shortlist before retrying. It does not expose the raw favorites response.

## Deployment and scopes

- Minimum site role: Viewer; the authenticated user must have the required target permissions.
- MCP scope: `tableau:mcp:favorites:write`.
- Mutation API scope: `tableau:favorites:update`. Resource checks may also require content and MCP
  site-setting read scopes; a mutation JWT itself requests only the mutation scope.
- Endpoint minimum versions: workbook/view 1.0, datasource 2.3, project 3.1.
- JWT scope declarations require API 3.27+ (Cloud December 2025 / Server 2025.3). PAT/session
  compatibility on older deployments must be checked separately.
- Collection/metric favorites and reorder are excluded. Project favorites are rejected when a tag
  restriction is configured. No new content permissions or persistent access are granted.

[Official favorites API reference](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm).

## Deferred flow support

The SDK has fixture-tested official flow favorite PUT and `/flows/{flowId}` DELETE contracts, but
registered tools intentionally reject/omit flow favorites in this initial candidate. The current
OAuth authorization uses a static per-tool scope map. A mixed favorites tool cannot request/enforce
flow read scope only when needed while preserving the repository invariant that disabled flow tools
do not advertise `tableau:flows:read`. No argument-aware auth infrastructure or additional flow
access is introduced here. Enabling the existing flow feature does not enable flow favorites. A
separately reviewed authorization design is required before exposing flow favorites.
