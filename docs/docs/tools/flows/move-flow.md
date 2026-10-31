---
sidebar_position: 20
---

# Move Flow

Moves a published Prep flow to an explicit project. It changes only the project reference and leaves the owner/content unchanged. A move can change inherited permissions. The flow is not executed.

## Required permissions

ExplorerCanPublish or higher and Tableau's ownership/project-leadership or administrator permissions, plus Write permission for the destination project.

## APIs called

- [Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
- [Update Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#update_flow)

## Required Tableau API scopes

`tableau:flows:update`, `tableau:flows:read` and `tableau:mcp_site_settings:read`.

## Arguments

`flowId`: source flow LUID. `projectId`: destination project LUID from List Projects. Both are required.

## Response behavior

Returns `status: moved` with the updated flow, or `status: unchanged` without a write when it is already in that project. Source-flow and destination-project restrictions are enforced before mutation. A destination mismatch after mutation is an unverified result; inspect the flow before retrying.

The tool follows the existing flow-write enablement setting.
