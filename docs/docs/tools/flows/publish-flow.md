---
sidebar_position: 20
---

# Publish Flow

Publishes an existing Tableau Prep TFL or TFLX to an explicit project. Requires ExplorerCanPublish or higher and permission to publish to the destination. The flow is not run after publishing.

## APIs called

- [File uploads](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm)
- [Publish Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#publish_flow)

## Required Tableau API scopes

`tableau:flows:create`, `tableau:file_uploads:create` and `tableau:mcp_site_settings:read`.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes | Published flow name. |
| `projectId` | Yes | Destination project LUID from List Projects. |
| `flowFilePath` | One file input | Local TFL/TFLX path, only on stdio without staged storage. |
| `flowUploadId` | One file input | Staged upload id from Request Flow Upload; use this on HTTP. |
| `overwrite` | No | Default false; true replaces a same-name flow in the project. |

## Response behavior

Returns `status: published` and the server-returned `flow` identity/project. Files must be non-empty and at most 256 MiB. Destination project restrictions are checked before upload. Overwrite is refused under tag-based flow scoping because the same-name overwrite target cannot be safely established from that context.

The tool follows flow-write and client-authoring enablement. It does not accept connection credentials. If the returned project cannot be verified, the result states that the write may have succeeded; inspect the project before retrying.
