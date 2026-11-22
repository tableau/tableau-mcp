---
sidebar_position: 3
---

# List Groups

{/* availability */}
<span className="toolAvailability">Available %coming_release% and later.</span>
{/* /availability */}

Retrieves a list of groups on the Tableau site. Each group includes its ID, name, and domain name.

Use this tool when you need to:

- Discover which groups exist on the site
- Look up a group's ID by name
- Check whether a group already exists before referring to it

:::warning[Admin Only]
Registered only when [`ADMIN_TOOLS_ENABLED`](../../configuration/mcp-config/env-vars.md#admin_tools_enabled)`=true`; the caller's site role is verified at request time and must be `SiteAdministratorCreator`, `SiteAdministratorExplorer`, or `ServerAdministrator`.
:::

## APIs called

This tool reads groups on the Tableau site through the **Tableau REST API** (Tableau Cloud or Server). Pagination is handled server-side (the tool fetches one page at a time), and any `filter` is applied by Tableau. The MCP-layer OAuth scope for this tool is `tableau:mcp:users:read`.

- Verifies the caller is a site administrator by reading the caller's own user record.
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the caller's site role for the admin check. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- Fetches the groups on the site, one page at a time, until the requested limit is reached.
  - `GET /api/{version}/sites/{siteId}/groups` — list groups on the site. Issued against the Tableau REST API; requires the `tableau:groups:read` OAuth scope. [Query Groups](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_groups)

## Optional arguments

### `filter`

A Tableau REST API filter expression with the format `field:operator:value`. Multiple expressions are comma-separated. The filter is applied by Tableau, not by this tool, so Tableau decides which fields and operators are valid. An invalid expression is rejected by Tableau and returned as an error. See [Filtering and Sorting](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm) in the Tableau REST API documentation.

#### Example

```json
{ "filter": "name:eq:Sales" }
```

<hr />

### `pageSize`

Number of groups to fetch from the API per page. Controls the server-side pagination page size. Must be a positive integer. Defaults to `100`; the API maximum is `1000`.

#### Example

`100`

<hr />

### `limit`

Maximum total number of groups to return. Must be a positive integer. If omitted, a default of `100` is applied and the result is flagged `truncated: true` with `truncationReason: "default-limit"`. A single call returns at most `1000` groups: a larger `limit` is clamped to `1000` and flagged `truncationReason: "max-limit"`. The effective cap is also bounded by the tool's configured [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) (or the per-tool [`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits) entry, if set), and the tightest limit wins. There is no page offset, so use `filter` to reach specific groups.

#### Example

`50`

## Example results

### Groups found

The result is a JSON object `{ groups: [...], totalAvailable: number, truncated: boolean, truncationReason?: string }`. Each group includes `id` (LUID), `name`, and `domain.name` (`local` for local groups):

```json
{
  "groups": [
    {
      "id": "group-abc123",
      "name": "Sales",
      "domain": { "name": "local" }
    },
    {
      "id": "group-def456",
      "name": "Marketing",
      "domain": { "name": "local" }
    }
  ],
  "totalAvailable": 2,
  "truncated": false
}
```

- `totalAvailable` — the number of groups Tableau reports for the request.
- `truncated` — `false` means `groups` is the complete set matching the request. `true` means more groups exist than were returned, so `groups` is only a partial list. Never report a truncated list as complete or as site-wide totals.
- `truncationReason` (present only when `truncated` is `true`):
  - `"requested-limit"` — the `limit` you passed cut the result short. Call again with a higher `limit` to get more.
  - `"admin-cap"` — a `MAX_RESULT_LIMIT[S]` cap configured for this tool cut the result short. `limit` cannot raise it, so narrow the `filter` or ask an administrator to raise the cap.
  - `"default-limit"` — you passed no `limit`, so the default of `100` applied. This is a **partial** page, not site-wide totals. Add a `filter` or pass a higher `limit` (up to `1000`).
  - `"max-limit"` — your `limit` exceeded the per-call maximum of `1000` and was clamped to it. Narrow the `filter` so fewer groups match.

### No groups found

If no groups match (or the caller lacks permission to view them), the tool returns a message:

```
No groups were found. Either none exist or you do not have permission to view them.
```

## Related

- [`list-users`](list-users.md) — list the users on the site
