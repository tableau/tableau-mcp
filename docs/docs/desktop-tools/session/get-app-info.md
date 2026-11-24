---
sidebar_position: 7
---

# Get App Info

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Reports application information about the %product_name% instance that is currently running, including live UI state. Use it to identify the Desktop build and to read whether the Start Page is visible, the Data Source page is active, and presentation mode is on. It returns whichever of the following the instance provides: the application version, the build identifier, the edition, the host operating system, and those UI flags.

## APIs called

This tool reads from the local %product_name% instance, not from the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes**: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Reads the running instance's application information — its application version, build, edition, operating system, and live UI state (Start Page visibility, Data Source page active, presentation mode).
  - `GET /v<x>/app` — read the application information of the running instance. [API reference](ext://eca/reference/index.html#tag/Application/operation/getApp)

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

## Notes and caveats

- **Fields are best-effort.** The result includes only the fields the running instance reports; any of `applicationVersion`, `build`, `edition`, `os`, `isStartPageVisible`, `isDataSourcePageActive`, or `isPresentationMode` that the instance omits is left out of the result rather than returned empty.

## Example result

```json
{
  "applicationVersion": "2026.1",
  "build": "20261.26.0701.1234",
  "edition": "Professional",
  "os": "macOS",
  "isStartPageVisible": false,
  "isDataSourcePageActive": false,
  "isPresentationMode": false
}
```

## Related

- `get-xml` — reads the open workbook's XML.
