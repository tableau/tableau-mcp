---
sidebar_position: 1
---

# Get Active Dialogs

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Lists the current actionable dialogs in the connected %product_name% instance, including each dialog's exact identity, visible message and diagnostic text, and invokable actions. Text buttons retain their exact labels; recognized unlabeled controls use semantic actions such as close. Self-clearing progress windows are excluded, and an empty `dialogs` array means no dialog needs a decision only when `uiSnapshotAvailable` is `true`. This is a read-only, idempotent inspection.

## APIs called

This tool reads from the local %product_name% instance, not from the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>` over the loopback interface, where `<x>` is the latest API version. There are **no OAuth scopes**: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Lists the current visible modal dialogs that need a decision, with each dialog's exact identity and invokable actions. Authorized by the session's loopback bearer token.
  - `GET /v<x>/app/dialogs` — list the current actionable dialogs. [API reference](ext://eca/reference/index.html#tag/Application/operation/listActiveDialogs)

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"12345"`

## Notes and caveats

- **Identity is always present; content is best-effort.** Every dialog includes `objectName`, `title`, and `className`. `messageText`, `informativeText`, `detailedText`, `detailedTextTruncated`, `iconLevel`, `buttons`, and `actions` appear only when the running instance reports them. Standard message boxes expose those fields precisely; generic dialogs may omit them or include incidental labels.
- **Diagnostic text is capped.** `detailedText` is limited to 1 MiB. When it is shortened, `detailedTextTruncated` is `true`.
- Copy `objectName`, `title`, `className`, `sessionId`, and `revision` verbatim into [`invoke-dialog-action`](./invoke-dialog-action.md), with an action this dialog advertises. Do not reconstruct a label from `buttons` or invent a `close`.

## Example results

### Dialogs that need a decision

```json
{
  "dialogs": [
    {
      "objectName": "saveChangesDialog",
      "title": "Save Changes",
      "className": "QMessageBox",
      "sessionId": "dialog-session-1",
      "revision": 1,
      "messageText": "Do you want to save changes to Regional Sales?",
      "informativeText": "Unsaved changes will be lost if you discard them.",
      "detailedText": "Workbook: Regional Sales",
      "iconLevel": "warning",
      "buttons": ["Save", "Discard", "Cancel"],
      "actions": [
        { "kind": "button", "label": "Save" },
        { "kind": "button", "label": "Discard" },
        { "kind": "button", "label": "Cancel" }
      ]
    }
  ],
  "uiSnapshotAvailable": true,
  "recentActions": []
}
```

### No dialog needs a decision

```json
{
  "dialogs": [],
  "uiSnapshotAvailable": true,
  "recentActions": []
}
```

## Related

- [`invoke-dialog-action`](./invoke-dialog-action.md) — invoke one exact action from a listed dialog
