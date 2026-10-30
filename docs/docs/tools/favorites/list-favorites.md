---
sidebar_position: 1
---

# List Favorites

`list-favorites` lists the authenticated user's Tableau favorites shortlist. There is no `userId`
argument, including for administrators. The user LUID comes from authenticated REST credentials;
when a bearer token has no user LUID, the tool resolves the current session and verifies that its
site matches the connection. If identity cannot be verified, it makes no favorites request.

Related tools: [Add Favorite](add-favorite.md), [Remove Favorite](remove-favorite.md).

## API called

[Get Favorites for User](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm#get_favorites_for_user):
`GET /api/{version}/sites/{siteId}/favorites/{authenticatedUserId}`.

## Optional arguments

- `pageNumber`: positive, 1-based server page; default 1.
- `limit`: maximum allowed favorites returned from this page, 1–100. A larger `limit` on the same
  page is needed to retrieve matches trimmed by a smaller limit.

Each call requests a single 100-entry server page; it does not automatically enumerate the whole
shortlist. Configured `MAX_RESULT_LIMIT` / `MAX_RESULT_LIMITS` also limit reachable pages and
output.

## Result and completeness

```json
{
  "favorites": [
    {
      "resourceType": "workbook",
      "resourceId": "11111111-1111-4111-8111-111111111111",
      "label": "Regional Sales"
    }
  ],
  "pageNumber": 1,
  "hasMore": null,
  "nextPageNumber": 2,
  "note": "Unsupported, deleted, and unverifiable favorites are omitted. ..."
}
```

`hasMore` describes the underlying server page, not the number of matching favorites. It is `null`
when Tableau omits pagination metadata or returns metadata inconsistent with the requested page. In
that case `nextPageNumber` is only a possible next page: a short or empty page does **not** prove
the whole shortlist was returned. When metadata confirms there are no more pages, `hasMore` is false
and `nextPageNumber` is omitted. Filtered pages can be empty even when a later server page exists.
No raw `totalAvailable` or omitted-content counts are exposed.

## Supported content and boundaries

The tool returns only workbook, view, datasource, and project IDs plus favorite labels.
Workbook/view/datasource favorites pass the existing resource-access checker, including all
applicable ID, parent-workbook, project, and tag restrictions. Project favorites must be in the
project allowlist (if set) and visible to the authenticated user; they are omitted whenever a tag
restriction is configured because a project's favorite cannot be matched to content tags. Visibility
lookup scans at most ten 100-project pages per invocation. A project that is not proven visible
within that bounded window is omitted rather than triggering an unbounded site enumeration.

Flow (deferred), collection, legacy metric, future unknown types, malformed/ambiguous favorites, and
label-only favorites whose targets were deleted are safely omitted. Their labels, IDs, and extra
metadata are not returned. The official
[3.29 XSD](https://help.tableau.com/samples/en-us/rest_api/ts-api_3_29.xsd) includes types beyond
the five documented API mutation types. Rich view metadata, owners, URLs, and raw favorite envelopes
are also omitted. Raw REST payload notifications are suppressed for favorites operations and their
resource probes, because debug notifications occur before bounded-context filtering. The standard
tool invocation, outcome, and activity logging remain active; secret masking is unchanged. Malformed
favorites responses and candidate-local project visibility schema errors are sanitized and do not
retain raw response data or an error cause. Favorites response schemas are revalidated even when
Tableau omits or misreports the JSON media type. Existing resource-checker operator-side app/file
error logging is reused; malformed upstream resource payloads can still appear in those inherited
logs. Client-visible checker error messages are discarded, and access remains fail-closed.

## Deployment and scopes

- Minimum site role: Viewer; actual Tableau content permissions still apply.
- MCP scope: `tableau:mcp:favorites:read`.
- Tableau list API scope: `tableau:content:read`.
- Resource checks can additionally require `tableau:mcp_site_settings:read`. See
  [configuration](../../configuration/tableau-config.md).
- Get Favorites requires REST API 2.5+; current-session identity fallback requires 3.1+.
- Favorites JWT scope declarations were added in REST API 3.27 (Cloud December 2025 / Server
  2025.3). Older PAT/session endpoint availability is separate from connected-app/UAT scope support.
- Registration and scope enforcement are unchanged. Connecting an app requires its granted scopes to
  match this deployment. Expanding connected-app or OAuth access is an operator decision.
- The candidate is verified with fixtures/unit tests; a live deployment contract check is still
  required before claiming compatibility with a particular Tableau site.

[Official favorites API reference](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm),
[current server session](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#get-current-server-session),
[connected-app scopes](https://help.tableau.com/current/online/en-us/connected_apps_scopes.htm).

## Deferred flow support

The SDK has fixture-tested official flow favorite PUT and `/flows/{flowId}` DELETE contracts, but
registered tools intentionally reject/omit flow favorites in this initial candidate. The current
OAuth authorization uses a static per-tool scope map. A mixed favorites tool cannot request/enforce
flow read scope only when needed while preserving the repository invariant that disabled flow tools
do not advertise `tableau:flows:read`. No argument-aware auth infrastructure or additional flow
access is introduced here. Enabling the existing flow feature does not enable flow favorites. A
separately reviewed authorization design is required before exposing flow favorites.
