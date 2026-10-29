---
sidebar_position: 3
---

# Remove Favorite

`remove-favorite` removes **shortlist membership only** from the authenticated user's favorites. It
never deletes a workbook, view, datasource, or project. Tableau content and permissions remain
intact.

## Required arguments

- `resourceType`: `workbook`, `view`, `datasource`, or `project`.
- `resourceId`: the target Tableau LUID, in UUID format.

There is no user selector. Identity resolution and supported-content boundary rules are described in
[List Favorites](list-favorites.md). Target access and all applicable bounded-context checks are
performed before removal; an out-of-bound favorite cannot be removed through this tool.
Access preflight sessions finish before the tool opens its mutation session. This avoids invalidating
the mutation's PAT session: [Tableau Cloud permits only one concurrent session per PAT](https://help.tableau.com/current/online/en-us/security_personal_access_tokens.htm).
Self identity is still verified on the mutation connection before writing; all probes use the same
authenticated request configuration and bounded-context restrictions.

## API called

[Delete favorites](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm):
`DELETE /api/{version}/sites/{siteId}/favorites/{authenticatedUserId}/{pluralType}/{resourceId}`.

`pluralType` is one of `workbooks`, `views`, `datasources`, or `projects`. HTTP 204 has no body.
Success returns only the target type/ID and `removedFromFavorites: true`. The Flow DELETE reference
repeats a datasource URL by mistake; the official [Tableau Server Client implementation](https://github.com/tableau/server-client-python/blob/master/tableauserverclient/server/endpoint/favorites_endpoint.py) confirms `/flows/{flowId}`,
which this SDK and its dedicated fixture use.

Repeated removal is intended to have no effect. Some Tableau versions can return `404010` for an
absent favorite; the tool preserves the server error and does not treat every 404 as a successful
removal. Missing content, a wrong site, and a missing user can also produce 404 errors.

## Deployment and scopes

- Minimum site role: Viewer; actual target permissions still apply.
- MCP scope: `tableau:mcp:favorites:write`.
- Mutation API scope: `tableau:favorites:delete`. No workbook/datasource content-delete scope is
  requested. Resource checks may require content and MCP site-setting read scopes.
- Endpoint minimum versions: workbook/view 2.0, datasource 2.3, project 3.1.
- Favorites JWT scope declarations require API 3.27+ (Cloud December 2025 / Server 2025.3). Older
  PAT/session support is a separate deployment check.
- Collections, legacy metrics, and reorder are excluded. Project favorites are rejected whenever a
  tag restriction is configured.
- The destructive tool annotation refers to removal of favorite membership only.

[Official favorites API reference](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm).

## Deferred flow support

The SDK has fixture-tested official flow favorite PUT and `/flows/{flowId}` DELETE contracts, but
registered tools intentionally reject/omit flow favorites in this initial candidate. The current
OAuth authorization uses a static per-tool scope map. A mixed favorites tool cannot request/enforce
flow read scope only when needed while preserving the repository invariant that disabled flow tools
do not advertise `tableau:flows:read`. No argument-aware auth infrastructure or additional flow
access is introduced here. Enabling the existing flow feature does not enable flow favorites. A
separately reviewed authorization design is required before exposing flow favorites.
