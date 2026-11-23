---
sidebar_position: 2
---

# Set Start Page Visibility

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Shows or hides the %product_name% Start Page and returns the actual resulting visibility. The value in the result is what %product_name% reports after the call, which can differ from the requested `isStartPageVisible`.

## APIs called

This tool acts on the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to show or hide the Start Page. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The JSON body is `{ "isStartPageVisible": <boolean> }`.
  - `POST /v<x>/app:toggleStartPage` — set Start Page visibility. [API reference](ext://eca/reference/index.html#tag/Application/operation/toggleStartPage)

## Required arguments

### `isStartPageVisible`

Whether the %product_name% Start Page should be visible. Type: boolean. Pass `true` to show it and `false` to hide it. The result's `isStartPageVisible` is the visibility %product_name% actually reports after the call, not a copy of this request value.

#### Example

```json
{ "isStartPageVisible": false }
```

:::note[Result can differ from the request]
If %product_name% returns a different visibility than you asked for, the tool reports that actual value (and a matching `message`) rather than echoing the request.
:::

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **Not read-only, but idempotent.** The tool changes Start Page visibility, so it is not a read-only operation; however, asking for a visibility the Start Page already has is safe to repeat.
- The `message` field still names the product "Tableau Desktop", as shown in the examples below. That is the literal text the tool returns today and is reproduced here verbatim; read it as %product_name%.

## Example results

### Start Page hidden

```json
{
  "isStartPageVisible": false,
  "message": "The Tableau Desktop Start Page is hidden."
}
```

### Start Page shown

```json
{
  "isStartPageVisible": true,
  "message": "The Tableau Desktop Start Page is visible."
}
```

### Requested visible, actual hidden

```json
{
  "isStartPageVisible": false,
  "message": "The Tableau Desktop Start Page is hidden."
}
```

## Related

- [`get-app-info`](../session/get-app-info.md) — reads application information for the running instance, including whether the Start Page is currently visible.
- [`list-instances`](../session/list-instances.md) — lists running %product_name% sessions so you can pass a `session` when more than one instance is connected.
