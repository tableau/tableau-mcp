---
sidebar_position: 1
title: PAT
---

# Personal Access Token

Tableau [Personal Access Tokens (PAT)][pat] enable users to utilize Tableau REST APIs without
requiring hard-coded credentials (username and password) or interactive sign-in.

For general multi-user HTTP deployments, prefer [OAuth](oauth.md). PAT-based HTTP configurations are
intended for testing/prototyping or deployments that are licensed and approved for user-based
licensing (UBL). Confirm non-OAuth HTTP usage with your Tableau licensing and security guidance.

When `AUTH` is `pat`, the following environment variables are required:

## `PAT_NAME`

The name of the PAT to use for authentication.

<hr />

## `PAT_VALUE`

The value of the PAT to use for authentication.

:::warning

Treat your personal access token value securely and do not share it with anyone or in any
client-side code where it could accidentally be revealed.

:::

<hr />

:::danger

As an additional operational caveat, do not use a PAT when
[`TRANSPORT`](../env-vars.md#transport) is `http` if you expect simultaneous requests from multiple
clients since PATs cannot be used concurrently. Signing in multiple times with the same PAT at the
same time will terminate any prior session and will result in an authentication error. See
[Understand personal access tokens](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm#understand-personal-access-tokens)
for more details.

:::

<hr />

## Embedded viz (optional)

When `AUTH` is `pat`, the MCP server cannot sign a Tableau embed token from the PAT itself —
the Tableau Embedding API accepts only a JWT, never a PAT. To render the embedded Tableau viz
in the MCP app UI under PAT auth, provide a dedicated, optional Connected App (Direct Trust)
credential whose signed JWT carries the `tableau:views:embed` scope. If these variables are not
set, the app falls back to an "Open in Tableau" link instead of embedding.

All four variables must be set together (or none):

- `EMBEDDING_CONNECTED_APP_CLIENT_ID` — the client ID of the embedding Connected App.
- `EMBEDDING_CONNECTED_APP_SECRET_ID` — the secret ID of the embedding Connected App.
- `EMBEDDING_CONNECTED_APP_SECRET_VALUE` — the secret value of the embedding Connected App.
- `EMBEDDING_USERNAME` — the Tableau username used as the JWT `sub` claim for the embedded viz.

:::warning

Treat the embedding Connected App secret value securely. This credential is used only to sign
the per-viz embed JWT; it is never exposed to the model or returned in any tool result visible
to the model.

:::

[pat]: https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm
