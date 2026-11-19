---
sidebar_position: 2
---

# Invoke Dialog Action

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Invokes one visible, enabled action on one current %product_name% dialog. Use a [`get-active-dialogs`](./get-active-dialogs.md) result as the only context: copy that item's exact identity and one action it advertises. Never guess a label or invent a `close`. To retry after an uncertain result, reuse the same `requestId`; never send a new one.

:::warning[Destructive]
This tool is not read-only. It invokes a live dialog action in %product_name%. It is idempotent per `requestId`: repeating a call with the same `requestId` and `action` retries the same logical request instead of acting twice.
:::

## APIs called

This tool acts on the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes**: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Selects one current actionable dialog by its exact `objectName`, `title`, `className`, `sessionId`, and `revision`, then invokes one enabled action that dialog advertises. Authorized by the session's loopback bearer token. A rejected request never invokes an action.
  - `POST /v<x>/app:invokeDialogAction` — invoke one exact action on one current dialog. [API reference](ext://eca/reference/index.html#tag/Application/operation/invokeDialogAction)

:::note[Action route not served]
If the running %product_name% instance does not serve `POST /v<x>/app:invokeDialogAction`, the tool reports that no dialog action ran. Do not retry `invoke-dialog-action`. Ask the user to handle the dialog.
:::

## Required arguments

### `dialog`
Exact identity of the dialog to act on. Type: object. Copy all five fields from one item returned by [`get-active-dialogs`](./get-active-dialogs.md). All five are required, extra fields are refused, and strings are compared exactly, including whitespace. Nested fields:

- `objectName` — object name from that dialog item. Type: string
- `title` — window title from that dialog item. Type: string
- `className` — window class name from that dialog item. Type: string
- `sessionId` — dialog session ID from that dialog item. Copy it exactly. Type: string
- `revision` — dialog revision from that dialog item. Copy it exactly. Type: non-negative integer

A request that matches no current dialog, or a stale `sessionId` or `revision`, does not invoke an action.

#### Example

```json
{
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox",
    "sessionId": "dialog-session-1",
    "revision": 1
  }
}
```

<hr />

### `requestId`
Unique ID for this logical request. Type: string of 1 to 128 printable ASCII characters, with no spaces. Preserve it for retries: a retry of the same request reuses the same `requestId` and `action`.

#### Example

`"req-save-1"`

<hr />

### `action`
The one action to invoke on that dialog. Pick an entry from that same item's `actions` array — not from `buttons`, and not a reconstructed label — and skip any action whose `enabled` is `false`. Discriminated by `kind`; extra fields are refused:

- `button` — click a labeled button. `label` (string, required, non-empty) must match that action's exact text
- `close` — invoke a recognized unlabeled close control. Supply `{ "kind": "close" }` only
- `cancel` — cancel a native panel. Supply `{ "kind": "cancel" }` only
- `choose-file` — choose one file. `path` (string, required, non-empty); `filterId` (string, optional)
- `choose-files` — choose several files. `paths` (array of non-empty strings, at least one, required); `filterId` (string, optional)
- `choose-directory` — choose a folder. `path` (string, required, non-empty)
- `save-file` — choose a save location. `path` (string, required, non-empty), `filterId` (string, required), and `overwriteConfirmed` (boolean, required). Set `overwriteConfirmed` to `true` only with the user's consent
- `choose-color` — pick a color. `red`, `green`, and `blue` (integers 0-255, required); `alpha` (integer 0-255, optional, only when the action reports `alphaSupported`)
- `submit-print` — submit a print panel. All required unless noted:
  - `printerId` — string
  - `range` — one of `all-pages`, `page-range`, `current-page`, `selection`
  - `sheetScope` — one of `entire-workbook`, `active-sheet`, `selected-sheets`
  - `firstPage`, `lastPage` — integers, 0 or more
  - `copies` — integer, 1 or more
  - `collate`, `exportSelection` — boolean
  - `outputPath` — non-empty string, optional

Respect the bounds and support flags the action advertises (for example `minimumCopies`, `maximumPage`, `supportsCollation`). A closed panel or a prepared print job is not proof the originating task succeeded; verify that operation separately.

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

#### Example (`kind: "save-file"`)

```json
{
  "action": {
    "kind": "save-file",
    "path": "/Users/me/Documents/Regional Sales.twbx",
    "filterId": "twbx",
    "overwriteConfirmed": false
  }
}
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **`outcome` is one of six values.** `completed`, `canceled`, `failed`, `expired`, `indeterminate`, or `dispatched-pending`. `status.state` and `status.effect` give the detail; `status.code` explains a failure.
- **Poll a pending request; do not send a new one.** For `dispatched-pending`, call [`get-active-dialogs`](./get-active-dialogs.md) and find this `requestId` in `recentActions`. Then verify the operation that opened the dialog.
- **Retry uncertainty with the same `requestId`.** If no valid outcome comes back, the action may already have run. Retry with the same `requestId` and `action`, or poll `recentActions`. Never use a new `requestId` for the same choice.
- **An empty `dialogs` array is proof only with `uiSnapshotAvailable`.** When `uiSnapshotAvailable` is `false`, the UI capture did not complete, so no dialogs listed does not mean none remain.
- Selection payloads such as file paths, colors, and printer choices are never echoed in the result.

## Example results

### Dialog dismissed (`outcome: "completed"`)

```json
{
  "outcome": "completed",
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox",
    "sessionId": "dialog-session-1",
    "revision": 1
  },
  "status": {
    "sessionId": "dialog-session-1",
    "revision": 1,
    "requestId": "req-save-1",
    "state": "completed",
    "effect": "dialog-dismissed"
  },
  "uiSnapshotAvailable": true,
  "dialogs": []
}
```

### Action still running (`outcome: "dispatched-pending"`)

```json
{
  "outcome": "dispatched-pending",
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox",
    "sessionId": "dialog-session-1",
    "revision": 1
  },
  "status": {
    "sessionId": "dialog-session-1",
    "revision": 1,
    "requestId": "req-save-1",
    "state": "pending",
    "effect": "none"
  },
  "uiSnapshotAvailable": true,
  "dialogs": [
    {
      "objectName": "saveChangesDialog",
      "title": "Save Changes",
      "className": "QMessageBox",
      "sessionId": "dialog-session-1",
      "revision": 1,
      "messageText": "Validation is still running.",
      "buttons": ["Discard", "Cancel"]
    }
  ]
}
```

### Dialog no longer active (`outcome: "failed"`)

```json
{
  "outcome": "failed",
  "dialog": {
    "objectName": "saveChangesDialog",
    "title": "Save Changes",
    "className": "QMessageBox",
    "sessionId": "dialog-session-1",
    "revision": 1
  },
  "status": {
    "sessionId": "dialog-session-1",
    "revision": 1,
    "requestId": "req-save-1",
    "state": "failed",
    "effect": "none",
    "code": "dialog-session-inactive"
  },
  "uiSnapshotAvailable": false,
  "dialogs": []
}
```

## Related

- [`get-active-dialogs`](./get-active-dialogs.md) — list current dialogs and the exact identity and actions this tool accepts
