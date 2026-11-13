---
sidebar_position: 2
---

# List Groups

Retrieves a list of groups on the Tableau site. Each group includes its ID, name, and domain name.

:::warning[Admin Only]
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

## APIs called

- [Get Groups on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_groups_on_site)
- [Get User on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) (to verify the caller's site role)

## Use cases

Use this tool when you need to:
- Discover which groups exist on the site
- Look up a group's ID by name
- Check whether a group already exists before referring to it

## Required permissions

- **Tableau Cloud**: Requires the `tableau:groups:read` and `tableau:users:read` OAuth scopes. The `tableau:users:read` scope is used to verify the caller's site role.
- **Tableau Server**: Site or server administrators
- **Site Role**: Must be one of:
  - SupportUser
  - SiteAdministratorCreator
  - SiteAdministratorExplorer
  - ServerAdministrator

## Configuration

Enable this tool by setting:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `filter` | string | No | A Tableau REST API filter expression with format `field:operator:value` (for example `name:eq:Sales`). Multiple expressions are comma-separated. |
| `pageSize` | number | No | Number of groups to fetch from the API per page (default 100, max 1000) |
| `limit` | number | No | Maximum number of groups to return. **If omitted, a default limit of `100` is applied**, and the result is flagged `truncated: true` with `truncationReason: "default-limit"`. A single call returns at most `1000` groups: a larger `limit` is clamped to `1000` and flagged `truncationReason: "max-limit"`. A `MAX_RESULT_LIMITS` cap configured for this tool also applies, and the tightest limit wins. There is no page offset, so neither a higher `limit` nor repeated calls advance past the ceiling. Use `filter` to reach specific groups. |

:::note[Server-side filtering]
Unlike [List Users](list-users.md), which filters client-side, `list-groups` passes `filter` to Tableau, so Tableau decides which fields and operators are valid. An invalid filter expression is rejected by Tableau and returned as an error. See [Filtering and Sorting](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm) in the Tableau REST API documentation.
:::

### Filter Examples

- Find a group by name: `name:eq:Sales`

## Response structure

Returns a JSON object `{ groups: [...], totalAvailable: number, truncated: boolean, truncationReason?: string }`.

Each group in `groups` includes:

- `id` – group ID (LUID)
- `name` – group name
- `domain.name` – domain of the group (`local` for local groups)

Other fields:

- `totalAvailable` – the number of groups Tableau reports for the request.
- `truncated` – `false` means `groups` is the complete set matching the request; `true` means more groups exist than were returned, so `groups` is only a partial list. Never report a truncated list as complete or as site-wide totals.
- `truncationReason` (present only when `truncated` is `true`):
  - `"requested-limit"` – the `limit` you passed cut the result short. Call again with a higher `limit` to get more.
  - `"admin-cap"` – a `MAX_RESULT_LIMITS` cap configured for this tool cut the result short. `limit` cannot raise it, so narrow the `filter` or ask an administrator to raise the cap.
  - `"default-limit"` – you passed no `limit`, so the default of `100` applied. This is a **partial** page, not site-wide totals; add a `filter` or pass a higher `limit` (up to `1000`).
  - `"max-limit"` – your `limit` exceeded the per-call maximum of `1000` and was clamped to it. Narrow the `filter` so fewer groups match.

## Example result

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

## Empty result

If no groups are found, the tool returns a message:

```
No groups were found. Either none exist or you do not have permission to view them.
```
