---
sidebar_position: 20
---

# Download Flow

Downloads a published Tableau Prep flow as its original TFL or TFLX. Requires Explorer or higher and Download permission for the flow. The flow is neither modified nor executed.

## APIs called

- [Download Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#download_flow)
- Query Flow when tool scoping requires an eligibility check.

## Required Tableau API scopes

`tableau:flows:download`, `tableau:flows:read` and `tableau:mcp_site_settings:read`.

## Required arguments

`flowId`: the flow LUID from [List Flows](list-flows.md).

## Response behavior

Returns local-file JSON (`kind`, `path`, `filename`, `mimeType`) when file storage is unavailable, or a short-lived `resource_link` when storage is configured. TFL and TFLX bytes are kept unchanged; the server-provided extension is preserved independently of ZIP signatures. Server filenames are sanitized; they cannot select a local directory. Downloads above 256 MiB are refused.

The tool follows the existing flow-read enablement setting. Permission and missing-content errors are returned as tool errors without a substitute file.
