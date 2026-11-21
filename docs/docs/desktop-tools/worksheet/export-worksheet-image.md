---
sidebar_position: 6
---

# Export Worksheet Image

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Renders one worksheet of the workbook open in %product_name% as an image. By default the rendered image comes back inline in the tool result, so a client can display it directly. Supply `filePath` instead and %product_name% writes the image to that path itself, and the tool returns the path rather than the bytes.

:::note[Not read-only]
The workbook is never modified — but the tool is not marked read-only, because a `filePath` you supply can overwrite an existing file at that path, and because each call renders afresh.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. These loopback calls carry **no OAuth scopes**; each is authorized by the running %product_name% instance's **per-session bearer token** over the loopback interface. A workbook must be open in the target session.

- Lists the worksheets in the open workbook so the name or id you passed can be resolved to one worksheet. When it resolves to none, the tool reports the available worksheets and no render is requested.
  - `GET /v<x>/workbook/worksheets` — list worksheets to resolve the selector. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Renders the resolved worksheet as an image. `filePath` and `mimeType`, when given, ride along on this call: %product_name% does the rendering, decides the format it actually produced, and writes the file when a path was requested. Only this call runs under the render deadline described in [Notes and caveats](#notes-and-caveats); the worksheet listing above does not.
  - `GET /v<x>/workbook/worksheets/{id}/image` — render the worksheet. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/exportWorksheetImage)
- Writes the rendered bytes to a cache file when they are too large to return inline (see [Inline size cap](#inline-size-cap)).
  - Local filesystem; no %ecapi_name% call.

## Optional arguments

Every argument is optional in the schema, but a worksheet selector is not: supply either `worksheetName` or its deprecated alias `worksheet`. The tool — not the schema — enforces that, so a call with neither is refused with `worksheetName is required (worksheet is a deprecated alias).`

### `worksheetName`

The worksheet to render, given as either its display name or its id. An id is matched first; failing that, the name must match exactly one worksheet in the open workbook. A selector that matches nothing is refused with an error listing the worksheets that are available, and nothing is rendered.

#### Example

```json
{ "worksheetName": "Sales by Region" }
```

<hr />

### `worksheet`

Deprecated alias of `worksheetName`, kept working so existing callers do not break. Prefer `worksheetName`. Passing both is allowed only when they are identical; if they disagree, the tool refuses with an error naming both values rather than guessing which worksheet you meant.

#### Example

`"Sales by Region"`

<hr />

### `filePath`
Absolute path to save the image to. Omit it to get the image inline. When you supply a path, %product_name% writes the file itself and the result is a one-line message naming the path and the rendered pixel dimensions — no image bytes ride back in the conversation, and no cache file is written.

The path is forwarded to %product_name% exactly as you wrote it, because %product_name% is the authority on which paths are acceptable on the machine it is running on. A path it rejects — a relative path, or one containing `..` — comes back as an invalid-`filePath` error from %product_name%, and nothing is rendered to disk. A blank string is treated as if the argument were absent.

#### Inline size cap

When `filePath` is omitted, the rendered image rides back inline only while it fits under the inline image cap ([`INLINE_IMAGE_MAX_BYTES`](../../configuration/mcp-config/env-vars.md), 1 MB by default). An image over the cap is written to a cache file on the local machine instead, and the result is a message giving the size, the cap, and the file to open — this keeps multi-megabyte images out of the conversation. An image whose size is exactly the cap still rides inline. Because SVG is returned twice over (as markup and as an image), it is measured at twice its size against the cap.

#### Example

```json
{ "worksheetName": "Sales by Region", "filePath": "/Users/me/reports/sales.png" }
```

<hr />

### `mimeType`
Image MIME type to render: `image/png` or `image/svg+xml`. Defaults to `image/png`. Omitting it requests no particular format, and %product_name% renders its own default.

This argument states the format you are asking for, not the one you are guaranteed to get. The result is labelled from the format %product_name% reports it actually rendered, so a request for SVG that %product_name% serves as PNG comes back labelled `image/png`. An SVG result is returned twice in the same response — once as text carrying the markup, and once as an image block — so clients that cannot render an SVG image block still receive the markup.

#### Example

`"image/svg+xml"`

<hr />

### `session`
The %product_name% session to render from. Omit it when the session is unambiguous — a pinned launching instance, or exactly one running instance. With two or more running and none pinned, the tool fails closed and lists the running session IDs rather than picking one.

#### Example

`"12345"`

## Notes and caveats

- **The render runs under a deadline.** A render that has not returned within the image-export deadline ([`IMAGE_EXPORT_TIMEOUT_MS`](../../configuration/mcp-config/env-vars.md), 30 seconds by default) is abandoned and reported as a timeout rather than waited on indefinitely. The usual cause is a modal dialog open in %product_name% blocking the render, so the timeout message tells you to check %product_name% rather than retry blindly. A request you cancelled yourself keeps its own cancellation error and is not reported as a timeout.
- **A worksheet that is not ready to render is reported as such.** %product_name% answers the render call with a not-ready response, and the tool surfaces that text; the fix is in %product_name%, not in the arguments.
- **A response carrying neither bytes nor a path is an error.** Rather than return an empty image, the tool reports that the export produced neither, and suggests passing `filePath` so %product_name% writes the image to disk instead.

## Example results

### Inline image (`filePath` omitted)

```json
{
  "content": [{ "type": "image", "data": "iVBORw0KGgoAAAANSUhEUg...", "mimeType": "image/png" }]
}
```

### Written by %product_name% (`filePath` supplied)

```json
{
  "content": [
    { "type": "text", "text": "Worksheet image written to /Users/me/reports/sales.png (1280x720)." }
  ]
}
```

### SVG (`mimeType: "image/svg+xml"`)

```json
{
  "content": [
    { "type": "text", "text": "<svg xmlns=\"http://www.w3.org/2000/svg\">...</svg>" },
    { "type": "image", "data": "PHN2ZyB4bWxucz0i...", "mimeType": "image/svg+xml" }
  ]
}
```

### Over the inline cap (`filePath` omitted)

```json
{
  "content": [
    {
      "type": "text",
      "text": "Worksheet image is 2097152 bytes, over the 1048576-byte inline cap. Written to a file instead of returned inline to keep large images out of the conversation.\n\nImage file: /Users/me/.tableau-mcp/cache/worksheet-image-abc123.png\n\nOpen the file to view the image. This local cache file remains until manually removed. To get a smaller inline image next time, request a worksheet instead of a whole dashboard, or pass a filePath to have Tableau write the image directly to a location of your choosing."
    }
  ]
}
```

## Related

- [`workbook-export-as`](../workbook/workbook-export-as.md) — exports the whole open workbook to a file (PDF, PowerPoint, packaged, or prior-version) without changing the open document.
- `get-sheets` — list the worksheet names and ids this tool accepts as a selector.
- `get-xml` — read a worksheet's structure rather than its rendered picture.
