---
sidebar_position: 2
---

# Apply Dashboard Changes

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies a modified dashboard layout to the dashboard of that name in the workbook currently open in %product_name%, replacing it with the dashboard XML you supply. The XML always comes from a cached file on the local machine: the path in `dashboardFile` is the handle to the content, so there is no way to pass a dashboard document in the call itself. When that cache file carries source metadata, a freshness check rejects the apply if this dashboard has changed in %product_name% since the read (_available September 2026 and later_).

:::warning[Destructive]
This tool is not read-only and not idempotent. It replaces the named dashboard in the live %product_name% session with the content you supply, and each call reads a new cache companion file.
:::

## APIs called

This tool acts on the dashboard in the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. The named dashboard is replaced in place through its own document route, so the rest of the open workbook is left untouched.

- Reads the dashboard content to apply from the cached file path, after checking that the file was produced by the same %product_name% session. Local filesystem; no API call.
- Validates the dashboard XML and confirms its `<dashboard name>` matches `dashboardName` before anything is sent to %product_name% — validated in-process (not an API call). Known failure patterns are caught here so invalid XML never reaches %product_name%.
- Resolves the named dashboard to the dashboard it will replace in the open workbook.
  - `GET /v<x>/workbook/dashboards` — list the open workbook's dashboards to resolve the target's id. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
- Replaces that dashboard in place with the layout you supply.
  - `POST /v<x>/workbook/dashboards/{id}/document` — replace the dashboard from the posted fragment (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/applyDashboardDocument)

## Required arguments

### `dashboardName`

Name of the dashboard to replace, as it appears in the open workbook. This must match the `name` attribute on the top-level `<dashboard>` element in the XML you supply.

#### Name match gate

Before anything is sent to %product_name%, the caller's `dashboardName` must agree with the `<dashboard name>` in the authored XML (compared after trimming and Unicode normalization). On a mismatch the tool returns an actionable error naming both values instead of applying the wrong dashboard. A cached file holding a whole `<workbook>` document is also rejected here: this tool expects a single `<dashboard name="...">` fragment, and the error tells you how to pull that one element out of the cached file and splice your edit back into it.

#### Example

`"Sales Dashboard"`

## Optional arguments

### `dashboardFile`

Absolute path to the cached dashboard XML file on the local machine. The cached file is the only way to supply dashboard content, so although the schema marks this optional, an apply that omits it — or passes an empty path — is refused with an error telling you where to get a path. The file must already exist; the tool returns an error if it is missing. The path is one produced by any tool that gets or modifies dashboard content.

The file must hold a single top-level `<dashboard name="...">` fragment (not a whole `<workbook>` document), beginning with an XML declaration or a tag.

#### Cache session guard

The file must carry a companion fingerprint matching the resolved %product_name% session. A cache produced by a different (or restarted) %product_name% instance is rejected before anything is applied, preventing cross-instance cache bleed.

:::note
The path must be a regular file inside the Desktop cache directory. A path outside that directory, or anything that is not a regular file, is refused as a security error and the apply does not run.
:::

#### Example

```json
{ "dashboardName": "Sales Dashboard", "dashboardFile": "/Users/me/.tableau-mcp/cache/dashboard-abc123.xml" }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

## Notes and caveats

- **In-place replace, never create.** The dashboard must already exist in the open workbook: this replaces it and does not add one. A name that resolves to no open dashboard is refused with a message pointing you at creating the dashboard in Desktop and adding the referenced worksheets there, then re-reading and applying the layout. The apply is serialized against other sheet edits so the two cannot interleave.
- **Apply is not re-verified.** A dashboard apply has no structural readback, so the success message carries an honest host-verification receipt that labels the applied intent as unverified. Treat dashboard state as unconfirmed until it is read back; do not report problems the host did not surface.
- **Load rejections surface verbatim.** When %product_name% accepts the request at the transport level but rejects the actual document load (for example, a qualified-name parse error), the tool reports that failure text as-is rather than a success message.
- **Every call reads a cache companion.** Each call reads the cached file and its fingerprint from the local filesystem; this is why the tool is not idempotent.

## Example result

```json
{
  "message": "Successfully applied dashboard update for \"Sales Dashboard\". The dashboard has been updated.\n\nHOST VERIFICATION — unverified: preflight clean · apply completed · full dashboard intent NOT re-verified. Treat dashboard state as unconfirmed until read back; do not report problems without host evidence."
}
```

## Related

- [`add-dashboard`](./add-dashboard.md) — adds a blank dashboard when the target does not exist yet.
- [`apply-workbook`](../workbook/apply-workbook.md) — replaces the whole open workbook rather than a single dashboard.
