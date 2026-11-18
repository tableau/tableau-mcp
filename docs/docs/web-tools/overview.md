---
sidebar_position: 0
---

# Tool Access Requirements

This reference covers all **55 web tools** in the current source registry, including tools that are
optional, loaded on demand, or intended only for MCP Apps. A registered tool is not necessarily
enabled in every hosted deployment. The separate Desktop authoring build uses local Tableau
Desktop sessions; this Cloud/Server site-role matrix does not apply to Desktop tools.

## User roles and site roles

The role below is the **authenticated user's site role on the target Tableau site**. MCP does not
require a separate user-role assignment. A role on another site does not grant access here. The
identity comes from the caller's OAuth/passthrough session or the configured PAT/direct-trust/UAT
identity, depending on authentication mode.

A site role sets the user's capability ceiling. Tableau content permissions, ownership, licenses,
site settings, enabled features, OAuth scopes, and the MCP server's configured content bounds can
further restrict what the user can do. A minimum role by itself does not grant content access.

## Role enforcement

Each web tool declares `minRequiredRole`. With `enforce-role-requirements` enabled, the server
resolves the current session's site role and hides tools whose declared minimum is above that role.
The checked-in `features.json` enables this flag; custom providers and deployments may override it.
If role lookup fails, tools requiring a role above Viewer are hidden. A declared `Viewer` minimum
does not trigger a registration-time role check; it is not a promise that an unlicensed or otherwise
unauthorized user can execute the tool.

The implementation ranks roles in this order (lowest first):

`Viewer` → `Explorer` → `ExplorerCanPublish` → `Creator` → `SupportUser` →
`SiteAdministratorExplorer` → `SiteAdministratorCreator` → `ServerAdministrator`.

`ExplorerCanPublish` is displayed as **Explorer (Can Publish)** in Tableau. “Administrator” in the
table means the runtime check accepts `SupportUser`, `SiteAdministratorExplorer`,
`SiteAdministratorCreator`, or `ServerAdministrator`. This reflects MCP's checks; Tableau still
controls which roles and operations are available on a particular Cloud or Server deployment.

Some tools declare `ExplorerCanPublish` yet also enforce an **administrator** check at request time:
`list-extract-refresh-tasks`, `update-cloud-extract-refresh-task`, and `delete-content`. Their lower
registration minimum does not let non-admin users execute them. Runtime checks and Tableau
permissions still apply when `enforce-role-requirements` is disabled.

## Site capabilities

When `enforce-registration-conditions` is enabled, the server probes each declared condition before
registering the tool. The checked-in `features.json` enables this flag. A missing capability or an
unresolved probe hides the affected tools; turning off these probes does not enable the downstream
Tableau capability.

| Condition | Site/caller requirement |
| --- | --- |
| `RequiresKnowledge` | Tableau Knowledge is available on the site (Tableau+); caller can access its read probe. |
| `RequiresPulse` | Tableau Pulse is available and enabled on the site; caller can access its metric-definition probe. |
| `RequiresPulsePremium` | Caller has the Pulse premium insights entitlement, in addition to Pulse access. |

Feature gates independently control availability. Admin tools require `ADMIN_TOOLS_ENABLED=true`
**or** `admin-tools`. Flow and Knowledge environment switches take precedence over their feature
flags when explicitly set. `INCLUDE_TOOLS` selects tools that are already enabled; it cannot bypass
roles, conditions, scopes, or feature gates. App-only visibility is a cooperating-client hint,
not an authorization boundary. See each tool page for its feature, client, storage, and version
requirements, and [OAuth configuration](../configuration/mcp-config/oauth.md) for scope enforcement.

## Per-tool roles and conditions

“Registration minimum” records the code declaration. “User requirement” includes explicit runtime
admin checks. Other Tableau content permissions and feature gates are documented on each tool page.
An em dash in the final column means no declared registration condition.

| Tool | Registration minimum | User requirement | Site capability conditions |
| --- | --- | --- | --- |
| [`list-datasources`](data-qna/list-datasources.md) | `Viewer` | `Viewer` or higher | — |
| [`list-extract-refresh-tasks`](tasks/list-extract-refresh-tasks.md) | `ExplorerCanPublish` | Administrator | — |
| [`update-cloud-extract-refresh-task`](tasks/update-cloud-extract-refresh-task.md) | `ExplorerCanPublish` | Administrator | — |
| [`confirm-update-cloud-extract-refresh-task`](tasks/confirm-update-cloud-extract-refresh-task.md) | `SupportUser` | Administrator | — |
| [`list-jobs`](jobs/list-jobs.md) | `SupportUser` | Administrator | — |
| [`list-users`](users/list-users.md) | `SupportUser` | Administrator | — |
| [`list-workbooks`](workbooks/list-workbooks.md) | `Viewer` | `Viewer` or higher | — |
| [`request-workbook-upload`](workbooks/request-workbook-upload.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`publish-workbook`](workbooks/publish-workbook.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`request-datasource-upload`](data-qna/request-datasource-upload.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`publish-datasource`](data-qna/publish-datasource.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`list-projects`](projects/list-projects.md) | `Viewer` | `Viewer` or higher | — |
| [`list-views`](views/list-views.md) | `Viewer` | `Viewer` or higher | — |
| [`list-custom-views`](views/list-custom-views.md) | `Viewer` | `Viewer` or higher | — |
| [`list-flows`](flows/list-flows.md) | `Viewer` | `Viewer` or higher | — |
| [`query-datasource`](data-qna/query-datasource.md) | `Viewer` | `Viewer` or higher | — |
| [`get-datasource-metadata`](data-qna/get-datasource-metadata.md) | `Viewer` | `Viewer` or higher | — |
| [`get-embed-token`](mcp-apps/get-embed-token.md) | `Viewer` | `Viewer` or higher | — |
| [`record-event`](mcp-apps/record-event.md) | `Viewer` | `Viewer` or higher | — |
| [`get-workbook`](workbooks/get-workbook.md) | `Viewer` | `Viewer` or higher | — |
| [`download-workbook`](workbooks/download-workbook.md) | `Explorer` | `Explorer` or higher | — |
| [`move-workbook`](workbooks/move-workbook.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`get-view`](views/get-view.md) | `Viewer` | `Viewer` or higher | — |
| [`get-flow`](flows/get-flow.md) | `Viewer` | `Viewer` or higher | — |
| [`list-flow-runs`](flows/list-flow-runs.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`list-flow-tasks`](flows/list-flow-tasks.md) | `Viewer` | `Viewer` or higher | — |
| [`describe-flow`](flows/describe-flow.md) | `Explorer` | `Explorer` or higher | — |
| [`get-flow-task`](flows/get-flow-task.md) | `Viewer` | `Viewer` or higher | — |
| [`run-flow`](flows/run-flow.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`run-flow-task`](flows/run-flow-task.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`cancel-flow-run`](flows/cancel-flow-run.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |
| [`get-view-data`](views/get-view-data.md) | `Viewer` | `Viewer` or higher | — |
| [`get-view-image`](views/get-view-image.md) | `Viewer` | `Viewer` or higher | — |
| [`get-custom-view-data`](views/get-custom-view-data.md) | `Viewer` | `Viewer` or higher | — |
| [`get-custom-view-image`](views/get-custom-view-image.md) | `Viewer` | `Viewer` or higher | — |
| [`list-all-pulse-metric-definitions`](pulse/list-all-pulse-metric-definitions.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`list-pulse-metric-definitions-from-definition-ids`](pulse/list-pulse-metric-definitions-from-definition-ids.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`list-pulse-metrics-from-metric-definition-id`](pulse/list-pulse-metrics-from-metric-definition-id.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`list-pulse-metrics-from-metric-ids`](pulse/list-pulse-metrics-from-metric-ids.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`list-pulse-metric-subscriptions`](pulse/list-pulse-metric-subscriptions.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`generate-pulse-metric-value-insight-bundle`](pulse/generate-pulse-metric-value-insight-bundle.md) | `Viewer` | `Viewer` or higher | `RequiresPulse` |
| [`generate-pulse-insight-brief`](pulse/generate-pulse-insight-brief.md) | `Viewer` | `Viewer` or higher | `RequiresPulse`, `RequiresPulsePremium` |
| [`generate-insight-cards`](pulse/generate-insight-cards.md) | `Viewer` | `Viewer` or higher | `RequiresPulse`, `RequiresPulsePremium` |
| [`search-content`](content-exploration/search-content.md) | `Viewer` | `Viewer` or higher | — |
| [`revoke-access-token`](token-management/revoke-access-token.md) | `Viewer` | `Viewer` or higher | — |
| [`reset-consent`](token-management/reset-consent.md) | `Viewer` | `Viewer` or higher | — |
| [`query-admin-insights`](admin-insights/query-admin-insights.md) | `SupportUser` | Administrator | — |
| [`update-user`](users/update-user.md) | `SupportUser` | Administrator | — |
| [`delete-content`](content/delete-content.md) | `ExplorerCanPublish` | Administrator | — |
| [`confirm-delete-content`](content/confirm-delete-content.md) | `SupportUser` | Administrator | — |
| [`render-interactive-viz`](views/render-interactive-viz.md) | `Viewer` | `Viewer` or higher | — |
| [`query-knowledge-context`](knowledge/query-knowledge-context.md) | `Viewer` | `Viewer` or higher | `RequiresKnowledge` |
| [`inspect-knowledge-context`](knowledge/inspect-knowledge-context.md) | `Viewer` | `Viewer` or higher | `RequiresKnowledge` |
| [`manage-knowledge-context`](knowledge/manage-knowledge-context.md) | `Creator` | `Creator` or higher | `RequiresKnowledge` |
| [`scaffold-data-app`](data-apps/scaffold-data-app.md) | `ExplorerCanPublish` | `ExplorerCanPublish` or higher | — |

## Combined-build tool discovery

The stateful combined build with `TOOL_PROFILE=combined-lean` initially exposes a separate
`load-web-tools` discovery helper. It has no independent minimum site role or registration
conditions. Its required `group` argument accepts a web tool group (such as `view`, `flow`, or
`knowledge`) or `all`. It registers the requested tools using the same role, scope, feature, and
site-capability checks described above; it does not grant access to otherwise unavailable tools.
It returns `status` (`loaded`, `already-loaded`, or retryable `partial`), `toolNames`, and optional
`warnings` and `notes`. See [tool profiles](../configuration/mcp-config/env-vars.md#tool_profile).

## Source and maintenance

The source of truth is `src/tools/web/tools.ts` and `src/tools/web/toolName.ts` for inventory,
each tool factory's `minRequiredRole` and `registrationConditions`, `src/sdks/tableau/types/user.ts`
for the role hierarchy, and `src/tools/web/adminGate.ts` for runtime administrator checks.
`src/server.web.ts` combines role, scope, condition, client, and configuration checks at registration.

When adding or changing a tool, update its page and the row above. The web tool documentation test
checks coverage, declared roles, conditions, and app-only visibility against the tool factories.
