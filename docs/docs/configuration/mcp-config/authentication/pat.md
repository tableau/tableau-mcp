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

[pat]: https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm
