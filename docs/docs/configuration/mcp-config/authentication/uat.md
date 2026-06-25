---
sidebar_position: 3
---

# Unified Access Tokens

When `AUTH` is `uat`, the MCP server will use the provided [Tableau Unified Access Token (UAT)][uat]
info to generate a scoped JSON Web Token (JWT) and use it to authenticate to the Tableau REST APIs.

The generated JWT will have the minimum set of scopes necessary to invoke the methods called by the
tool being executed.

For example, for the [`query-datasource`](../../../tools/data-qna/query-datasource.md) tool, since
it internally calls into VizQL Data Service, the JWT will only have the
`tableau:viz_data_service:read` scope.

## Prerequisites

- Tableau Cloud only, December 2025 release.
- You must create a [UAT configuration][uat].

## Environment Variables

### `UAT_TENANT_ID`

- The tenant ID of the UAT configuration.
- Used as the `https://tableau.com/tenantId` claim of the JWT.

<hr />

### `UAT_ISSUER`

- The unique issuer URI of the UAT configuration.
- Used as the `iss` claim of the JWT.

<hr />

### `UAT_USERNAME_CLAIM_NAME`

- The name of the claim of the Tableau UAT JWT that maps to the Tableau username.
- Defaults to `email`.

<hr />

### `UAT_USERNAME_CLAIM`

The username for the claim of the JWT specified by the
[`UAT_USERNAME_CLAIM_NAME`](#uat_username_claim_name) environment variable.

- Can either be a hard-coded username, or the OAuth username by setting it to `{OAUTH_USERNAME}`.
- Defaults to the value of the [`JWT_SUB_CLAIM`](./direct-trust.md#jwt_sub_claim) environment
  variable which is used in the [Direct Trust](./direct-trust.md) authentication method. This is
  only provided as a convenience and does not imply the JWT will have a `sub` claim.

<hr />

### `UAT_PRIVATE_KEY`

The RSA private key used to sign the UAT JWTs.

- The private key corresponding to the public key provided in the UAT config.
- If the UAT config has a `jwks_uri` defined, you must also provide the secret key identifier in the
  [`UAT_KEY_ID`](#uat_key_id) environment variable.
- It or `UAT_PRIVATE_KEY_PATH` must be provided, but not both.
- Example:

  ```
  -----BEGIN RSA PRIVATE KEY-----\nMIIE...HZ3Q==\n-----END RSA PRIVATE KEY-----
  ```

<hr />

### `UAT_PRIVATE_KEY_PATH`

The absolute path to the RSA private key (.pem) file used to sign the UAT JWTs.

- It or `UAT_PRIVATE_KEY` must be provided, but not both.

<hr />

### `UAT_KEY_ID`

When a `jwks_uri` is defined in the UAT configuration, this is the secret key identifier of the
public key that Tableau will use to validate the signature of the UAT JWTs.

- Used as the `kid` claim of the JWT.

<hr />

### `JWT_ADDITIONAL_PAYLOAD`

A JSON string that includes any additional claims and user attributes to include on the JWT. It also
supports dynamically including the OAuth username.

Example:

```json
{
  "username": "{OAUTH_USERNAME}",
  "region": "West",
  "https://tableau.com/siteId": "c1dd3d70-dca2-400a-a0dd-cae9b658587a"
}
```

[uat]: https://help.tableau.com/current/api/cloud-manager/en-us/docs/unified_access_tokens.html
