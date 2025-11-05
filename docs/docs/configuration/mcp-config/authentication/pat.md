---
sidebar_position: 2
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

[pat]: https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm
