---
sidebar_position: 20
---

# Request Flow Upload

Creates a short-lived staged upload URL for a TFL or TFLX file. Requires ExplorerCanPublish or higher, configured file storage, and OAuth or server-side authentication. Passthrough authentication is refused.

## Required arguments

`fileName`: name ending in `.tfl` or `.tflx`.

## Response behavior

Returns `flowUploadId`, `uploadUrl`, `expiresAt`, `maxSizeBytes` and `requiredHeaders`. Upload the bytes with the required headers, then pass the id to [Publish Flow](publish-flow.md). The maximum is 256 MiB. Flow uploads use `application/octet-stream` for both TFL and TFLX. Flow upload capabilities use a dedicated storage namespace and cannot refer to workbook/data-source uploads.

The upload URL is a capability: do not post it in issue reports. This tool follows flow-write and client-authoring enablement. It does not publish or execute a flow.
