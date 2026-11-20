---
sidebar_position: 2
---

# Reload a Workspace Extension

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Reloads one workspace extension from the repository Packages folder in the connected %product_name% instance, so a new or changed extension shows up in the Extensions menu and toolbar, and reloads any of its open pages without opening new ones. It also removes Packages extensions that are no longer in that folder. Name the extension with `extensionId`, the stable `id` from [`get-workspace-extensions`](./get-workspace-extensions.md). When the reload finishes, the result message says the extension was reloaded. When it has been accepted and is still being applied, the message says the reload was requested. The call is idempotent.

:::note[Not read-only]
This tool is not read-only. It reloads the named workspace extension in the live %product_name% session and can remove Packages extensions that are no longer in the repository Packages folder.
:::

## APIs called

This tool reloads a workspace extension in the running %product_name% instance, not through the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; the call is authorized instead by the running %product_name% instance's **per-session bearer token over the loopback interface**.

- Reloads the workspace extension named by `extensionId` from the repository Packages folder, refreshes its open pages without opening new ones, and removes Packages extensions that are no longer in that folder. The request has no body. The id is percent-encoded in the path, so `ab12 cd` is sent as `ab12%20cd`. Authorized by the session's loopback bearer token.
  - `POST /v0/app/extensions/{id}:reload` — reload one workspace extension. _[API reference link TBD]_

## Required arguments

### `extensionId`

The workspace extension to reload. Type: string. Minimum length: 1. Use the `id` from [`get-workspace-extensions`](./get-workspace-extensions.md). That `id` stays the same across sessions. The extension's `name` and its `extensionKey.id` are different values.

#### Example

```json
{ "extensionId": "ab12 cd" }
```

:::note
When no installed extension has that id, the tool returns an error and does not report that the extension was reloaded. The text is `No workspace extension has id ` followed by the id and a period, for example `No workspace extension has id missing.` A synchronous not-found adds a second line, `tableau-error-code: workspace-extension-not-found`. The same id sentence is returned when the reload is accepted and then fails, as in `No workspace extension has id ws-ext-disabled.`

A disabled extension fails with `Workspace extension is disabled.` An extension that is not in the repository Packages folder fails with `Not in the Packages folder.`
:::

## Optional arguments

### `session`

Identifier of the target %product_name% session. Type: string. Optional when a session is pinned or when it is the only running instance. When `session` is omitted, blank, or `default`, the tool uses the pinned session if one is set, and otherwise the sole running instance. An explicit session selects that instance, including when a different session is pinned.

#### Example

`"12345"`

:::note
With no session to resolve — none pinned, and either no running instance or more than one — the tool refuses instead of choosing. The multiple-instance refusal lists the session ids and points at [`list-instances`](../session/list-instances.md). A `session` that is not among the running instances is refused as well.
:::

## Notes and caveats

- This tool is left out when the connected %ecapi_name% version is known to be older than 0.2.34. The compared version is the pinned session's version, or, when no session is pinned, the highest version among running instances. An unknown version leaves the tool available.
- When the reload route itself is not found, the tool returns `This Tableau Desktop build does not serve the reload-workspace-extension endpoint yet. Tell the user their Desktop build is too old for this read and that a Desktop update enables it. Do not retry.` An unknown extension id is a different refusal, described under `extensionId`.

## Example results

### Reload finished (`extensionId`: `"ab12 cd"`)

```json
{
  "extensionId": "ab12 cd",
  "message": "Reloaded workspace extension \"ab12 cd\"."
}
```

### Reload accepted, still being applied

```json
{
  "extensionId": "ab12 cd",
  "message": "Requested reload of workspace extension \"ab12 cd\"; Desktop is still applying it."
}
```

## Related

- [`get-workspace-extensions`](./get-workspace-extensions.md) — lists installed workspace extensions, including disabled ones, and returns the stable `id` this tool reloads
