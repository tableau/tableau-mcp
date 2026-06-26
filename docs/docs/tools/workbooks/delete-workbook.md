---
sidebar_position: 3
---

# Delete Workbook

Deletes a workbook from the current Tableau Cloud site as the destructive step of the Stale Content
Cleanup workflow.

This tool is **admin-only** and is registered only when the `ADMIN_TOOLS_ENABLED` feature flag is
enabled. Non-administrator callers are rejected before any action is taken.

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`): tags the workbook with
   `pending-deletion` (reversible, visible in the Tableau UI; label configurable via the `tag`
   argument), reports the workbook name, project, and owner, and does **not** delete anything.
2. **Delete** (`confirm: true`): permanently removes the workbook. Before deleting, the server
   re-fetches the workbook and **verifies it carries the pending-deletion tag** applied in the
   preview step. A confirmed delete against an untagged workbook is rejected (see the
   [server-authoritative gate](#server-authoritative-gate) note). On Tableau Cloud the workbook is
   moved to the [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm)
   and can be restored for a limited time before permanent removal.

:::warning Human confirmation required — advisory, not enforced
Between the preview and the delete, the calling agent is instructed (via the tool description and
the preview response) to surface the workbook identity to the user and obtain explicit approval
before deleting. This human-approval step is a **prompt-level expectation, not a server guarantee**:
the tag gate proves a preview *ran*, but the server cannot observe whether a human actually approved.
An agent that calls preview and then confirm itself satisfies the gate with no human in the loop.
Enforcing true human-in-the-loop (out-of-band approval the agent cannot forge) is tracked as
follow-up work.
:::

### Server-authoritative gate

The confirm phase does not trust any caller-supplied value. It re-fetches the workbook from Tableau
and only deletes if the workbook is currently tagged `pending-deletion` (or the custom `tag` value).
The tag is server-side state that the caller can only set by running the preview phase, so the gate
genuinely proves a preview happened — it **cannot** be bypassed by computing or guessing a token,
which the prior `confirmationToken` (a caller-derivable `sha256`) could be. The live re-fetch
deliberately ignores any cached copy so the check reflects the workbook's current state at delete
time.

**What this gate does and does not guarantee.** It proves a preview *ran* (closing the
caller-computable-token bypass). It does **not** prove a *human approved* — an agent that runs both
the preview and the confirm satisfies it on its own. Server-enforced human-in-the-loop requires an
out-of-band approval primitive (e.g. MCP URL-mode elicitation) and is tracked as follow-up work.

## Tool scoping

This tool honors the same [tool-scoping](../../configuration/mcp-config/tool-scoping.md) rules as the
read tools (for example [Get Workbook](get-workbook.md)). If the server is configured with a bounded
context (such as `INCLUDE_WORKBOOK_IDS`, `INCLUDE_PROJECT_IDS`, or `INCLUDE_TAGS`), a workbook that
falls outside that scope cannot be previewed or deleted — the request is rejected before any tag or
delete, so there are no side effects. Being an administrator does not bypass tool scoping.

## APIs called

- [Add Tags to Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_workbook) (preview phase)
- [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook) (preview phase)
- [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site) (owner lookup + admin check)
- [Delete Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook) (delete phase)

## Required arguments

### `workbookId`

The LUID of the workbook to delete, potentially retrieved by the [List Workbooks](list-workbooks.md)
tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Optional arguments

### `confirm`

When omitted or `false`, runs the non-destructive preview (tags and reports). When `true`,
permanently deletes the workbook — but only if the workbook already carries the pending-deletion tag
from a prior preview (verified by a live re-fetch; see
[server-authoritative gate](#server-authoritative-gate)). Pass the same `tag` value used in the
preview if you overrode the default.

Example: `true`

### `tag`

The label applied to the workbook during the preview phase to mark it as pending deletion.
Reversible and visible in the Tableau UI. Defaults to `pending-deletion`; callers (for example a
stale-content cleanup workflow) can override it with their own vocabulary.

Example: `stale-pending-deletion`

## Side effects

- **Preview** adds the pending-deletion tag (`pending-deletion` by default, or the `tag` value) to
  the workbook. This is reversible and visible in the Tableau UI.
- **Delete** removes the workbook. On Tableau Cloud the workbook is moved to the recycle bin and can
  be [restored](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm) for a limited
  time before it is permanently purged. Always run the preview first and confirm the workbook
  identity before deleting.
