---
sidebar_position: 1
---

# Get Workspace Extensions

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Lists the workspace extensions installed in the connected %product_name% instance, including disabled ones. Each entry's `id` stays the same across sessions and is the value [`reload-workspace-extension`](./reload-workspace-extension.md) passes as `extensionId`. The tool returns the list from the %ecapi_name%: an `extensions` array whose entries include `id`, `name`, `author`, `isEnabled`, and `extensionKey` (`id`, `version`, and `url`). `isEnabled` is `false` for a disabled extension, and that entry is still in the list. This is a read-only, idempotent call.

## APIs called

This tool reads workspace extensions from the running %product_name% instance, not from the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; the call is authorized instead by the running %product_name% instance's **per-session bearer token over the loopback interface**.

- Lists the workspace extensions installed in the instance, including disabled ones. Authorized by the session's loopback bearer token.
  - `GET /v0/app/extensions` — list installed workspace extensions. _[API reference link TBD]_

## Optional arguments

### `session`

Identifier of the target %product_name% session. Type: string. Optional when a session is pinned or when it is the only running instance. When `session` is omitted, blank, or `default`, the tool uses the pinned session if one is set, and otherwise the sole running instance. An explicit session selects that instance, including when a different session is pinned.

#### Example

`"12345"`

:::note
With no session to resolve — none pinned, and either no running instance or more than one — the tool refuses instead of choosing. The multiple-instance refusal lists the session ids and points at [`list-instances`](../session/list-instances.md). A `session` that is not among the running instances is refused as well.
:::


## Example results

### No workspace extensions

```json
{
  "extensions": []
}
```

### Enabled and disabled extensions

```json
{
  "extensions": [
    {
      "id": "ws-ext-enabled",
      "extensionKey": {
        "id": "com.example.enabled",
        "version": "1.2.0",
        "url": "file:///Packages/a/index.html"
      },
      "name": "Enabled Extension",
      "author": "Example Co",
      "isEnabled": true
    },
    {
      "id": "ws-ext-disabled",
      "extensionKey": {
        "id": "com.example.disabled",
        "version": "0.1.0",
        "url": "file:///Packages/b/index.html"
      },
      "name": "Disabled Extension",
      "author": "Example Co",
      "isEnabled": false
    }
  ]
}
```

## Related

- [`reload-workspace-extension`](./reload-workspace-extension.md) — reloads one listed extension by the stable `id` from this list
