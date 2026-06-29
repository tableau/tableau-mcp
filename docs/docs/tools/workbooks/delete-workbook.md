---
sidebar_position: 3
---

# Delete Workbook

Deletes a workbook from the current Tableau Cloud site as the destructive step of the Stale Content
Cleanup workflow.

This tool is **admin-only** and is registered only when the `ADMIN_TOOLS_ENABLED` environment variable is
enabled. Non-administrator callers are rejected before any action is taken.

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`): tags the workbook with
   `pending-deletion` (reversible, visible in the Tableau UI; label configurable via the `tag`
   argument), reports the workbook name, project, and owner, returns a `confirmationToken`, and does
   **not** delete anything.
2. **Delete** (`confirm: true` + `confirmationToken`): permanently removes the workbook. The token
   from the preview step is **required** — deletion is rejected without a matching token, a friction
   gate requiring a deliberate second call rather than a blind one-shot call (see the
   [`confirmationToken`](#confirmationtoken) note on what this does and does not guarantee). On Tableau Cloud the workbook is moved to
   the [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm) and can be
   restored for a limited time before permanent removal.

:::warning Human confirmation required
Between the preview and the delete, the calling agent is instructed (via the tool description and
the preview response) to surface the workbook identity to the user and obtain explicit approval
before deleting. The `confirmationToken` enforces that a preview ran, but the **human approval**
step is a prompt-level expectation — agents must not auto-confirm or compute the token themselves.
:::

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
permanently deletes the workbook (also requires `confirmationToken`).

Example: `true`

### `confirmationToken`

Required when `confirm` is `true`. The `confirmationToken` value returned by the preview step for
this workbook. Deletion is rejected without a matching token — a friction gate requiring a
deliberate second call rather than a blind single call.

The token is a deterministic `sha256(siteId:workbookId)` value, so it enforces an explicit second
call but does **not** prove the preview/tag step actually ran (a caller who knows the workbook LUID
can compute it). Guaranteeing a preview happened would require server-side state.

Example: `3a7f9c2e1b04`

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
