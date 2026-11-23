---
sidebar_position: 10
---

# Export Dashboard Image

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Renders one dashboard from the workbook open in %product_name% as an image. By default the image comes back inline in the tool result; supply `filePath` and %product_name% writes the image to that path instead, and the result reports the path rather than the bytes.

:::warning[Destructive]
This tool is not read-only and not idempotent. When you supply `filePath`, %product_name% writes to that location and overwrites any file already there.
:::

## APIs called

This tool reads from the workbook open in the local %product_name% instance, not from the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. Rendering is a two-step sequence: the dashboard you name is resolved to an id against the live workbook, then that id is rendered.

- Lists the dashboards in the open workbook so your selector can be resolved to a dashboard id. If it resolves to nothing, or to more than one dashboard, the tool stops here and no render is attempted.
  - `GET /v<x>/workbook/dashboards` — list the dashboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
- Renders the resolved dashboard. `filePath` and `mimeType` ride along as query parameters, so %product_name% decides both the output format and whether it writes the file. This call runs under its own deadline ([`IMAGE_EXPORT_TIMEOUT_MS`](../../configuration/mcp-config/env-vars.md), 30 seconds by default), so a render that never returns (for example, because %product_name% is showing a modal dialog) is reported as a timeout rather than waited on indefinitely.
  - `GET /v<x>/workbook/dashboards/{id}/image` — render the dashboard as an image. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/exportDashboardImage)

## Optional arguments

### `dashboardName`

The dashboard to render, given as either its name or its id.

**Required unless it is supplied through the deprecated `dashboard` alias.** The two arguments are the same selector, so exactly one of them has to carry a value: a call that supplies neither fails with `dashboardName is required (dashboard is a deprecated alias).` and never reaches %product_name%. When both are supplied, `dashboardName` is the one used — and it must agree with the alias, or the call is refused (see [`dashboard`](#dashboard)).

#### How the selector resolves

The value is matched against the dashboards in the open workbook, id first and then name:

- An exact id match wins immediately
- Otherwise an exact name match is used, provided exactly one dashboard has that name. If several do, the tool lists them with their ids and asks you to pass one id
- A name containing XML entities (for example `&amp;`) is also retried in its decoded form
- If nothing matches, the error lists the dashboards that are available

#### Example

`"Executive Overview"`

<hr />

### `dashboard`

Deprecated alias of `dashboardName`, kept working for existing callers. Pass one or the other. Supplying both is allowed only when they are identical; if they disagree the call fails with an error naming both values, and no dashboard list or render is attempted.

#### Example

`"Executive Overview"`

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

<hr />

### `filePath`
Absolute path for %product_name% to save the image to. When supplied, the image is not returned inline: %product_name% writes the file and the tool reports the path, along with the rendered pixel dimensions when %product_name% provides them. Omit it to get the image inline instead.

The path is forwarded exactly as you give it — %product_name% is the authority on what a valid path is, and rejects a relative or `..`-bearing path with an invalid-path error naming the offending value. Nothing is written in that case.

#### Inline size cap

When the image comes back inline, its footprint in the conversation is capped ([`INLINE_IMAGE_MAX_BYTES`](../../configuration/mcp-config/env-vars.md), 1 MB by default). Over the cap, the tool writes the rendered bytes to a local cache file and returns that path with an explanatory message instead of the image. SVG counts double against the cap, because it is returned both as markup and as an image.

#### Example

`"/Users/me/exports/executive-overview.png"`

<hr />

### `mimeType`
Format to render. One of `image/png` or `image/svg+xml`. When omitted, no format is requested and %product_name% renders its default, PNG.

An SVG that comes back inline is returned twice in the same result: once as its markup in a text block, so clients that cannot display an SVG image still get the content, and once as an image. The result is labelled with the format %product_name% reports it actually rendered, which is not necessarily the one you requested.

#### Example

`"image/svg+xml"`

## Example results

### Returned inline (`filePath` omitted)

```json
{ "type": "image", "mimeType": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAA..." }
```

### Written to a file (`filePath` supplied)

```text
Dashboard image written to /Users/me/exports/executive-overview.png (1400x1000).
```

### Over the inline cap

```text
Dashboard image is 2097152 bytes, over the 1048576-byte inline cap. Written to a file instead of returned inline to keep large images out of the conversation.

Image file: /Users/me/.tableau-mcp/cache/dashboard-image-abc123.png

Open the file to view the image. This local cache file remains until manually removed. To get a smaller inline image next time, request a worksheet instead of a whole dashboard, or pass a filePath to have Tableau write the image directly to a location of your choosing.
```

## Related

- [`workbook-export-as`](../workbook/workbook-export-as.md) — exports the whole open workbook to a file (PDF, PowerPoint, packaged, or prior-version) without changing the open document.
- `get-sheets` — lists the dashboards in the open workbook, with the ids this tool accepts.
- [`export-storyboard-image`](../storyboard/export-storyboard-image.md) — renders a storyboard's active story point instead of a dashboard.
