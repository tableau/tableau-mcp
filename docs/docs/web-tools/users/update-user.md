---
sidebar_position: 2
---

# Update User

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Updates the site role of a user on the Tableau site. Primary use case: downgrade inactive users to `Unlicensed` to reclaim licenses. This is a two-phase mutation — a preview call reports the proposed change and returns a single-use confirmation token, and a second call with that token applies it.

:::warning[Admin Only]
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

## APIs called

This tool reads and updates a user on the Tableau site through the **Tableau REST API** (Tableau Cloud or Server). Because the mutation is two-phase, a preview call only reads the user, and the role change is written only on a confirmed call. Both operations require the caller to be a site administrator (see the gating admonition above). The MCP-layer OAuth scope for this tool is `tableau:mcp:users:write`.

- Looks up the target user to report its current site role (runs in both the preview and the confirm phase).
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the user's current site role. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- Applies the new site role, only on a confirmed call (`confirm: true` with a valid token).
  - `PUT /api/{version}/sites/{siteId}/users/{userId}` — update the user's site role. Issued against the Tableau REST API; requires the `tableau:users:update` OAuth scope. [Update User](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user)

## Required arguments

### `userId`
The LUID of the user to update. Obtain from [`list-users`](list-users.md).

#### Example

```json
{ "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

### `siteRole`
The new site role. One of `Creator`, `Explorer`, `ExplorerCanPublish`, `SiteAdministratorCreator`, `SiteAdministratorExplorer`, `Viewer`, or `Unlicensed`.

#### Example

```json
{ "siteRole": "Unlicensed" }
```

## Optional arguments

### `confirm`
Whether to apply the change. When omitted or `false` (the default), the tool runs in **preview** mode: it looks up the user, reports the current and proposed site role, and returns a single-use `confirmationToken` — no change is made. Set to `true` to apply the change; this requires a matching `confirmationToken`.

#### Example

`true`

<hr />

### `confirmationToken`
The single-use token returned by a prior preview call, bound to the previewed `userId` and `siteRole`. **Required when `confirm` is `true`.** The MCP server's in-process mutation guard verifies and consumes the token — and re-checks the live user state — before applying the change, so a token minted for a different role, a forged or precomputed token, or a `confirm: true` call with no prior preview is rejected. The token is not a Tableau REST API feature; it is held only in the MCP server's memory for the preview session.

#### Example

`"<token from preview>"`

## Notes and caveats

- **Requires explicit human approval.** After a preview, present the proposed role change to the user and get their explicit approval before calling again with `confirm: true`. Do not auto-confirm.
- **The confirmation token is ephemeral.** It lives only in the MCP server's memory for the preview session; if a confirm is rejected for a missing or stale token, re-run the preview to mint a fresh one.

## Example results

### Preview (dry run)

Request:

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "siteRole": "Unlicensed"
}
```

Result:

```
Preview — user 'jsmith' (john.smith@example.com) would be changed from Creator → Unlicensed.
No change has been made.
Once approved, call again with confirm: true and confirmationToken: "..."
```

### Confirm

Request:

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "siteRole": "Unlicensed",
  "confirm": true,
  "confirmationToken": "<token from preview>"
}
```

Result:

```
User 'jsmith' has been successfully updated. New site role: Unlicensed.
```

## Related

- [`list-users`](list-users.md) — look up the `userId` to update.

{/* tool-details */}
## Confirm and audit

This mutation is **two-phase**, gated on a server-generated single-use confirmation token:

1. **Preview** (default — `confirm` omitted or `false`): looks up the user, reports the current
   and proposed site role, and returns a single-use `confirmationToken`.
2. **Update** (`confirm: true` + `confirmationToken`): applies the role change. The server
   verifies and consumes the token first.

The token is server-generated and **bound to the previewed `userId` and `siteRole`**: a token minted
while previewing role A cannot confirm an update to role B, and a `confirm: true` with no prior
preview (no valid token) is rejected server-side. Present the change to the user and get explicit
approval before confirming.

## REST API reference

- [Update User](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user) — `PUT /api/{version}/sites/{siteId}/users/{userId}`
{/* /tool-details */}
