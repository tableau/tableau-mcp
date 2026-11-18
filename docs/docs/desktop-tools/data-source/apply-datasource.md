---
sidebar_position: 16
---

# Apply Datasource Changes

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Replaces an existing datasource definition in the workbook currently open in %product_name% with a document previously retrieved from that workbook. The document always comes from a cached file on the local machine: the path in `datasourceFile` is the handle to the content, so there is no way to pass a datasource document in the call itself. This tool does not add datasources or import `.tds`/`.tdsx` files.

:::warning[Destructive]
This tool is not read-only and not idempotent. It replaces the named datasource in the live %product_name% session with the content you supply, and each call reads a cached file from the local filesystem.
:::

## APIs called

This tool acts on one datasource in the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. The named datasource is replaced in place through its own document route, so the rest of the open workbook is left untouched.

- Resolves `datasourceName` to the datasource it will replace in the open workbook. Authorized by the session's loopback bearer token; requires a workbook to be open. This list-and-match step finishes before any cache file is opened.
  - `GET /v<x>/workbook/datasources` — list the open workbook's datasources to resolve the target's id. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/listWorkbookDatasources)
  - The requested name or id is then matched to one of those datasources in-process (not an API call).
- Reads the datasource content to apply from the cached file path, after checking that the file is a regular file in the local cache directory and, when a companion fingerprint is present, that it belongs to the resolved %product_name% session. Local filesystem; no API call.
- Replaces that datasource in place with the document you supply. Authorized by the same session's loopback bearer token.
  - `POST /v<x>/workbook/datasources/{id}/document` — replace the datasource from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyDatasourceDocument)

## Required arguments

### `datasourceName`

Name or inventory id of the datasource to replace in the open workbook. Type: string. The inventory id is the `id` from the open workbook's datasource list (it may be URL-encoded), not a published LUID.

#### Name or id resolution

An exact inventory id match is tried first, then an exact name match. Names containing XML entities (for example `&amp;`) are also matched against their decoded form. Only datasources that have both an id and a name are considered.

:::note
If the value matches no datasource, the tool reports that the datasource was not found and lists the available datasources so you can retry with a specific value. If a name matches more than one datasource, the tool asks you to disambiguate by supplying the inventory id. Resolution finishes before any cache file is opened, so a missing or ambiguous name never reads local files or posts a document.
:::

#### Example

`"Sales"`

:::note
- `Datasource "${}" matched multiple datasources. Specify one id: ${}`
- `Datasource "${}" was not found. Available datasources: ${}`
:::

## Optional arguments

### `datasourceFile`

Absolute path to the cached datasource document on the local machine. The cached file is the only way to supply datasource content, so although the schema marks this optional, an apply that omits it — or passes an empty path — is refused with an error telling you where to get a path. Use a cached datasource path from `get-xml`, edit it with the cache read/write tools, then pass that path here. The file must already exist; a missing path is refused.

:::note[Posted as-is]
The cached bytes are posted unchanged. This tool does not check that the file holds a `<datasource>` fragment, so empty or malformed content is sent through for %product_name% to reject.
:::

#### Cache session guard

When the cached file carries a readable companion fingerprint, that fingerprint must match the resolved %product_name% session. A cache produced by a different (or restarted) %product_name% instance is rejected before anything is applied. A missing or unreadable companion is allowed.

#### Cache containment

The file must be a regular file inside the local cache directory. A path outside that directory, or one that is not a regular file (for example a symlink), is refused as a security error before anything is posted.

#### Example

```json
{ "datasourceName": "Sales", "datasourceFile": "/Users/me/.tableau-mcp/cache/datasource-Sales-abc123.xml" }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

## Notes and caveats

- **In-place replace, never create.** The datasource must already exist in the open workbook: this replaces its local definition and does not add a datasource or import a `.tds` or `.tdsx` file. A name or id that resolves to none is refused; use `get-datasources` to check what is open. The apply is serialized against other mutating applies so they cannot interleave.
- **Apply is not re-verified.** A datasource apply has no structural readback, so the result carries an honest receipt that lists the applied structure as unverified. %product_name% accepting the document and the preflight warning count are observed; whether the datasource kept the structure you intended is not. Read the datasource back if you need to confirm it.
- **Last writer wins.** This apply does not check whether the datasource changed in %product_name% since the document was read, so a later apply overwrites an intervening edit. It does not publish changes to a Tableau Cloud or Server datasource.
- **Load rejections surface verbatim.** When %product_name% accepts the request at the transport level but rejects the document (for example, an empty body, a malformed document, or a document that targets a different datasource), the tool reports that failure text as-is rather than a success message.

## Example result

```json
{
  "message": "Successfully applied datasource update for \"Sales\". The datasource has been updated. No post-apply datasource readback ran.",
  "warnings": [],
  "nextAction": {
    "kind": "done",
    "label": "Datasource apply accepted — structure not re-read",
    "receipt": {
      "did": [
        "Desktop accepted the datasource XML apply for \"Sales\"",
        "preflight validation returned 0 warning(s)"
      ],
      "didNot": [],
      "unverified": [
        "whether the applied datasource retained its intended structure — no structural readback ran (datasource applies have none)"
      ]
    }
  }
}
```

## Related

- `get-xml` — reads the datasource document into a cache file you can edit and then apply.
- `get-datasources` — lists every datasource in the open workbook, or reads one datasource's metadata, so you can confirm the name or id before applying.
