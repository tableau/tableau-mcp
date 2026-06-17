---
sidebar_position: 4
---

# Delete Datasource

Deletes a published data source from the current Tableau site as the destructive step of the
Stale Content Cleanup workflow.

This tool is **admin-only** and is registered only when the `ADMIN_TOOLS_ENABLED` feature flag is
enabled. Non-administrator callers are rejected before any action is taken.

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`): tags the data source with
   `pending-deletion` (reversible, visible in the Tableau UI; label configurable via the `tag`
   argument), reports the data source name, project, and owner, **warns which workbooks and flows
   depend on it and may break**, returns a `confirmationToken`, and does **not** delete anything.
2. **Delete** (`confirm: true` + `confirmationToken`): permanently removes the data source. The
   token from the preview step is **required** — deletion is rejected without a matching token,
   which forces a deliberate two-step delete rather than a blind one-shot call. On Tableau Cloud the data source
   is moved to the [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm)
   and can be restored for a limited time before permanent removal; on Tableau Server there is no
   recycle bin and deletion is permanent.

:::warning[Human confirmation required]
Between the preview and the delete, the calling agent is instructed (via the tool description and
the preview response) to surface the data source identity **and its dependent content** to the user
and obtain explicit approval before deleting. The `confirmationToken` enforces that a preview ran,
but the **human approval** step is a prompt-level expectation — agents must not auto-confirm or
compute the token themselves.
:::

:::note[Dependent content is not deleted]
Deleting a published data source does **not** delete the workbooks or flows that use it. Those
items remain but lose this data source (their views/extracts may break). The preview phase surfaces
these dependents so you can decide before deleting. The dependency check uses the Metadata API; if
the Metadata API is disabled or unavailable, the preview notes that and still allows deletion.
:::

## Tool scoping

This tool honors the same [tool-scoping](../../configuration/mcp-config/tool-scoping.md) rules as the
read tools (for example [Get Datasource Metadata](get-datasource-metadata.md)). If the server is
configured with a bounded context (such as `INCLUDE_DATASOURCE_IDS` or `INCLUDE_PROJECT_IDS`), a data
source that falls outside that scope cannot be previewed or deleted — the request is rejected before
any tag or delete, so there are no side effects. Being an administrator does not bypass tool scoping.

## APIs called

- [Add Tags to Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source) (preview phase)
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source) (preview phase)
- [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html) (preview phase — downstream workbook/flow dependency check)
- [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site) (owner lookup + admin check)
- [Delete Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source) (delete phase)

## Required arguments

### `datasourceId`

The LUID of the published data source to delete, potentially retrieved by the
[List Datasources](list-datasources.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Optional arguments

### `confirm`

When omitted or `false`, runs the non-destructive preview (tags, warns about dependents, and
reports). When `true`, permanently deletes the data source (also requires `confirmationToken`).

Example: `true`

### `confirmationToken`

Required when `confirm` is `true`. The `confirmationToken` value returned by the preview step for
this data source. Deletion is rejected without a matching token, which forces a deliberate two-step
delete rather than a blind single call.

The token is a deterministic `sha256(siteId:datasourceId)` value, so it enforces an explicit second
call but does **not** prove the preview/tag step actually ran (a caller who knows the datasource LUID
can compute it). Guaranteeing a preview happened would require server-side state.

Example: `3a7f9c2e1b04`

### `tag`

The label applied to the data source during the preview phase to mark it as pending deletion.
Reversible and visible in the Tableau UI. Defaults to `pending-deletion`; callers (for example a
stale-content cleanup workflow) can override it with their own vocabulary.

Example: `stale-pending-deletion`

## Side effects

- **Preview** adds the pending-deletion tag (`pending-deletion` by default, or the `tag` value) to
  the data source. This is reversible and visible in the Tableau UI. No content is deleted.
- **Delete** removes the data source. On Tableau Cloud it is moved to the recycle bin and can be
  [restored](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm) for a limited time
  before it is permanently purged; on Tableau Server there is no recycle bin and deletion is
  permanent. Dependent workbooks and flows are not deleted but lose this data source. Always run the
  preview first, review the dependency warning, and confirm the data source identity before deleting.
