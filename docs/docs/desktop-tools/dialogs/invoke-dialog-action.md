---
sidebar_position: 2
---

# Invoke Dialog Action

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Invokes one visible, enabled action on one current %product_name% dialog. Use a [`get-active-dialogs`](./get-active-dialogs.md) result as the only context: copy that item's exact identity and one exact action from its `actions` array. Never guess a label, invent a `close`, or retry.

:::warning[Destructive]
This tool is not read-only and not idempotent. It invokes a live dialog action in %product_name%, so repeating the call is not a no-op.
:::

## APIs called

This tool acts on the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes**: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Selects one current actionable dialog by exact `objectName`, `title`, and `className`, then invokes one visible enabled action copied from that dialog's `actions` array. Authorized by the session's loopback bearer token. A rejected request never invokes an action.
  - `POST /v<x>/app:invokeDialogAction` — invoke one exact action on one current dialog. [API reference](ext://eca/reference/index.html#tag/Application/operation/invokeDialogAction)

:::note[Action route not served]
If the running %product_name% instance does not serve `POST /v<x>/app:invokeDialogAction`, the tool reports that no dialog action ran. Do not retry `invoke-dialog-action`. Ask the user to handle the dialog.
:::

## Required arguments

### `dialog`
Exact identity of the dialog to act on. Type: object. Copy `objectName`, `title`, and `className` from one item returned by [`get-active-dialogs`](./get-active-dialogs.md). All three strings are required and compared exactly, including whitespace. Nested fields:

- `objectName` — object name from that dialog item. Type: string
- `title` — window title from that dialog item. Type: string
- `className` — window class name from that dialog item. Type: string

A request that matches no current dialog, or that matches more than one, is refused and no action is invoked.

#### Example

```json
{
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox"
  }
}
```

<hr />

### `requestId`

Unique logical request ID; preserve it for retries.

### `action`
The one action to invoke on that dialog. Copy one entry from that same item's `actions` array — not from `buttons`, and not a reconstructed label. Discriminated by `kind`:

- `button` — click a labeled button. `label` is required, must contain at least one character, and must match that action's exact text
- `close` — invoke a recognized unlabeled close control. Supply `{ "kind": "close" }` only; a `label` is refused

An action that is missing, ambiguous, or disabled is refused and nothing is invoked.

#### Example (`kind: "button"`)

```json
{
  "action": { "kind": "button", "label": "Discard" }
}
```

#### Example (`kind: "close"`)

```json
{
  "action": { "kind": "close" }
}
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"studio-1"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **Do not retry after any outcome.** `dismissed` and `action-invoked-dialog-remains` both mean the action was invoked. `no-active-dialog` means no action ran because nothing actionable was present. None of those results is a reason to call this tool again.
- **An unconfirmed call may already have invoked the action.** If the request is sent and no valid outcome comes back, do not call this tool again and do not click another action. You may call [`get-active-dialogs`](./get-active-dialogs.md) once for a fresh inspection; that list does not prove the first click did not happen. Ask the user to handle any remaining choice.

## Example results

### Dialog dismissed (`outcome: "dismissed"`)

```json
{
  "outcome": "dismissed",
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox"
  },
  "action": { "kind": "button", "label": "Discard" },
  "dialogs": []
}
```

### Action invoked, dialog remains (`outcome: "action-invoked-dialog-remains"`)

```json
{
  "outcome": "action-invoked-dialog-remains",
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox"
  },
  "action": { "kind": "button", "label": "Discard" },
  "dialogs": [
    {
      "objectName": "saveChangesDialog",
      "title": "Save Changes",
      "className": "QMessageBox",
      "messageText": "Validation is still running.",
      "buttons": ["Discard", "Cancel"]
    }
  ]
}
```

### No active dialog (`outcome: "no-active-dialog"`)

```json
{
  "outcome": "no-active-dialog",
  "dialogs": []
}
```

## Related

- [`get-active-dialogs`](./get-active-dialogs.md) — list current dialogs and the exact identity and actions this tool accepts
