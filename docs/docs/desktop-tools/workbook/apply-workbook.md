---
sidebar_position: 3
---

# Update Workbook

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies modified workbook content to the workbook currently open in %product_name%, replacing it with the XML you supply. The XML always comes from a cached file on the local machine: the path in `workbookFile` is the handle to the content, so there is no way to pass a workbook document in the call itself. When that cache file carries source metadata, a freshness check rejects the apply if the workbook has changed in %product_name% since the read (_available September 2026 and later_).

:::warning[Destructive]
This tool is not read-only and not idempotent. It replaces the whole workbook in the live %product_name% session with the content you supply, and each call reads a new cache companion file.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. The apply is a single authoritative write: %product_name% replaces the open workbook from the document you post.

- Reads the workbook content to apply from the cached file path, after checking that it sits in the Desktop cache directory and, when it has a fingerprint, that it came from the same %product_name% session. Local filesystem; no API call.
- Validates the workbook XML before anything is sent to %product_name% — validated in-process (not an API call). Known failure patterns are caught here so invalid XML never reaches %product_name%.
- Applies the whole workbook document to the open %product_name% workbook, replacing it.
  - `POST /v<x>/workbook/document` — replace the open workbook from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)

## Optional arguments

### `workbookFile`

Absolute path to the cached workbook XML file on the local machine. The cached file is the only way to supply workbook content, so although the schema marks this optional, an apply that omits it — or passes an empty path — is refused with an error telling you where to get a path. The file must already exist; the tool returns an error if it is missing. The path is one produced by any tool that gets or modifies workbook content.

The file must be a regular file inside the Desktop cache directory: the absolute path in `TABLEAU_MCP_CACHE_DIR` when set, otherwise the server's default cache folder. A path outside that directory is refused. The file must be non-empty and begin with an XML declaration or a tag. A file that carries credentials redacted when it was read is refused, because applying it cannot restore them; re-read the workbook from %product_name% instead.

#### Cache session guard

When the file has a companion fingerprint, it must match the resolved %product_name% session. A cache produced by a different (or restarted) %product_name% instance is rejected before anything is applied, preventing cross-instance cache bleed. A file with no fingerprint, or one that cannot be read, is still applied.

#### Example

Pass the path that [`get-xml`](./get-xml.md) returns in `file` mode:

```json
{ "workbookFile": "<cache directory>/workbook-abc123.xml" }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

## Notes and caveats

- **Whole-workbook replace.** The posted document is authoritative: %product_name% replaces the entire open workbook from it. This is serialized against per-sheet edits so the two cannot interleave.
- **Apply is not re-verified.** A whole-workbook apply has no structural readback, so the success message carries an honest host-verification receipt that labels the applied intent as unverified. Treat sheet-level state as unconfirmed until it is read back; do not report problems the host did not surface.
- **Load rejections surface verbatim.** When %product_name% accepts the request at the transport level but rejects the actual document load (for example, a qualified-name parse error), the tool reports that failure text as-is rather than a success message.
- **Every call reads a cache companion.** Each call reads the cached file and any fingerprint from the local filesystem; this is why the tool is not idempotent.

## Example result

```json
{
  "message": "Successfully applied workbook update. The workbook has been updated.\n\nHOST VERIFICATION — unverified: preflight clean · apply completed · full workbook intent NOT re-verified. Treat sheet-level state as unconfirmed until read back; do not report problems without host evidence."
}
```
