---
sidebar_position: 3
title: Direct Trust
---

# Direct Trust

When `AUTH` is `direct-trust`, the MCP server will use the provided [Tableau Direct Trust Connected
App][direct-trust] info to generate a scoped [JSON Web Token (JWT)][jwt] and use it to authenticate
to the Tableau REST APIs.

The generated JWT will have the minimum set of scopes necessary to invoke the methods called by the
tool being executed.

For example, for the [`query-datasource`](../../../tools/data-qna/query-datasource.md) tool, since
it internally calls into VizQL Data Service, the JWT will only have the
`tableau:viz_data_service:read` scope.

## Required Variables

### `JWT_SUB_CLAIM`

The username for the `sub` claim of the JWT.

<hr />

### `CONNECTED_APP_CLIENT_ID`

The client ID of the Tableau Connected App.

<hr />

### `CONNECTED_APP_SECRET_ID`

The secret ID of the Tableau Connected App.

<hr />

### `CONNECTED_APP_SECRET_VALUE`

The secret value of the Tableau Connected App.

:::warning

Treat your Connected App secret value securely and do not share it with anyone or in any client-side
code where it could accidentally be revealed.

:::

<hr />

## Optional Variables

### `JWT_ADDITIONAL_PAYLOAD`

A JSON string that includes any additional user attributes to include on the JWT.

Example:

```json
{ "region": "West" }
```

[direct-trust]: https://help.tableau.com/current/online/en-us/connected_apps.htm#direct-trust
[jwt]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#jwt
