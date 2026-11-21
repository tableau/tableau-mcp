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
