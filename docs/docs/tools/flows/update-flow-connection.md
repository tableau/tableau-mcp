---
sidebar_position: 20
---

# Update Flow Connection

Changes the server address, port and/or username for one connection of a published Prep flow. This MCP tool requires an administrator role. It never runs the flow and does not accept passwords or authentication secrets.

## APIs called

- [Query Flow Connections](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow_connections)
- [Update Flow Connection](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#update_flow_connection)
- Query Flow when tool scoping requires an eligibility check.

## Required Tableau API scopes

`tableau:flow_connections:update`, `tableau:flow_connections:read`, `tableau:flows:read` and `tableau:mcp_site_settings:read`.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `flowId` | Yes | Flow LUID from List Flows. |
| `connectionId` | Yes | Connection LUID from Get Flow with connections enabled. |
| `serverAddress` | At least one change | Hostname or IP address without URL scheme, path or credentials. |
| `serverPort` | At least one change | Integer port from 1 to 65535. |
| `userName` | At least one change | Connection username; manage secrets separately in Tableau. |

## Response behavior

Verifies that the connection belongs to the permitted flow, sends only the supplied fields and returns `status: updated`, `flowId` and the connection. Secret/undocumented response fields are not returned. A returned identity or changed-attribute mismatch is unverified; inspect the flow before retrying. Connector-specific restrictions can reject an update.

The tool follows the existing flow-write enablement setting. Address and username values are redacted from invocation arguments.
