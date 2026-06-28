---
sidebar_position: 1
---

# Who Am I

Reports where the current MCP session is connected to Tableau: the authentication method, server,
site, and authorized user.

Use `whoami` to confirm the active connection — for example when a user asks "where am I
connected?", "which Tableau site is this?", or "who am I signed in as?".

## Arguments

This tool requires no input. It operates on the authentication context already associated with the
MCP request.

## Result

The tool always reports the configured connection details and, when available, enriches them with
live details from the current Tableau session ([REST API: Get Current Server Session][session-api]).

| Field                 | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| `authMethod`          | Authentication method in use: `pat`, `uat`, `direct-trust`, or `oauth`.              |
| `credentialType`      | Credential type for the request: `X-Tableau-Auth`, `Bearer`, or `Passthrough`.       |
| `server`              | Tableau server URL.                                                                  |
| `site`                | Site `name`, `luid`, and (when verified) `contentUrl`.                               |
| `user`                | `username` and `luid`, plus (when verified) `fullName`, `email`, and `siteRole`.     |
| `liveSessionVerified` | `true` if the live session lookup succeeded; `false` if only configured info is shown. |

When `liveSessionVerified` is `false` — for example if the live session lookup fails — the tool
still succeeds and returns the configured connection details (auth method, server, site name/LUID,
username, user LUID).

[session-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#get-current-server-session
