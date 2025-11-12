---
sidebar_position: 1
title: PAT
---

# Personal Access Token

Tableau [Personal Access Tokens (PAT)][pat] enable users to utilize Tableau REST APIs without
requiring hard-coded credentials (username and password) or interactive sign-in.

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

Do not use a PAT if [`TRANSPORT`](../env-vars.md#transport) is `http` if you expect simultaneous
requests from multiple clients since PATs cannot be used concurrently. Signing in multiple times
with the same PAT at the same time, whether to the same site or a different site, will terminate any
prior session and will result in an authentication error. See
[Understand personal access tokens](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm#understand-personal-access-tokens)
for more details.

[OAuth](oauth.md) is recommended but [Direct Trust](direct-trust.md) can also be used.

:::

[pat]: https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm
