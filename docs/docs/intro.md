---
sidebar_position: 1
---

# Introduction

Tableau's official MCP Server. Helping *agents* see and understand data.


[Tableau MCP](https://github.com/tableau/tableau-mcp) is an open source GitHub project that uses the
[Model Context Protocol](https://modelcontextprotocol.io/introduction) standard for simplifying
agent-to-Tableau communication, enabling users to bring their Tableau data into AI tools. This MCP server can be used with any Tableau edition on Cloud or Server, though specific tools may be gated by SKU. 

Tableau MCP is also a managed service on every Tableau Cloud pod, and it is accessible over the url: `https://mcp.tableau.com`. See [Hosted Tableau MCP](hosted-tableau-mcp) for more details.

Follow along and share ideas with the Tableau MCP team by creating issues or discussions on the
repository. You can also join the [Tableau Developer Platform](https://www.tableau.com/developer)
and reach out in the [#tableau-ai-solutions](https://tableau-datadev.slack.com/archives/C07LMAVG4N6)
Slack channel in the Tableau #DataDev workspace.

## Use Cases

- Chat with your data: Reuse your trusted, curated data models to answer ad-hoc questions that are grounded on your pre-built data semantics and metadata. 
- Find insights from pre-built data artifacts: Enable agents to query your published workbooks and extract data, images, custom views and more. 
- Discover and analyze Pulse metrics: Bring 100% accuracy and deterministic AI to any agent by using Pulse metric definitions and the Pulse insights engine.
- Manage and administer your Tableau environment.

### Coming soon! 
- Prepare your data and manage prep flows.
- Pre-built skills that use the Tableau MCP toolset.
- Collaboratively or autonomously build Tableau workbooks: new tools and skills allow local coding agents to directly work with and take action on Tableau Desktop. Drag and drop your way to insights or let an agent do it for you!


## Tool List

| **Tool**                                                                                                              | **Description**                                                                                                     | **SKU**      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| [list-datasources](tools/data-qna/list-datasources.md)                                                                | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])                        | All SKUs     |
| [list-workbooks](tools/workbooks/list-workbooks.md)                                                                   | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])                            | All SKUs     |
| [list-projects](tools/projects/list-projects.md)                                                                      | Retrieves a list of projects from a specified Tableau site ([REST API][list-projects])                              | All SKUs     |
| [list-views](tools/views/list-views.md)                                                                               | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                                    | All SKUs     |
| [list-custom-views](tools/views/list-custom-views.md)                                                                 | Retrieves a list of custom views for a specified Tableau workbook ([REST API][list-custom-views])                   | All SKUs     |
| [list-flows](tools/flows/list-flows.md)                                                                               | Retrieves a list of Tableau Prep flows from a specified Tableau site ([REST API][list-flows])                       | All SKUs     |
| [get-datasource-metadata](tools/data-qna/get-datasource-metadata.md)                                                  | Fetches datasource metadata including table relationships, datasource and field descriptions, field roles and types, calculation strings, and parameters for the specified datasource ([Metadata API][meta] & [VDS API][vds])                         | All SKUs\*   |
| [get-workbook](tools/workbooks/get-workbook.md)                                                                       | Retrieves information about a workbook for a specified workbook on a Tableau site ([REST API][get-workbook])                        | All SKUs     |
| [get-flow](tools/flows/get-flow.md)                                                                                   | Retrieves information on a Tableau Prep flow including output steps and recent runs ([REST API][get-flow])                          | All SKUs     |
| [delete-content](tools/content/delete-content.md)                                                                     | Admin-only. Two-phase (preview/confirm) delete of a workbook, data source, or extract refresh task ([REST API][delete-workbook], [REST API][delete-datasource], [REST API][delete-extract-refresh-task]) | All SKUs     |
| [get-view-data](tools/views/get-view-data.md)                                                                         | Retrieves data in CSV format for the specified view in a Tableau workbook. *Note: the get-view-data api currently has a limitation that when used on a dashboard sheet type, it will only return data for the first worksheet in the dashboard. This will be fixed in the 26.3 fall release.* ([REST API][get-view-data])               | All SKUs     |
| [get-view-image](tools/views/get-view-image.md)                                                                       | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])                        | All SKUs     |
| [get-custom-view-data](tools/views/get-custom-view-data.md)                                                           | Retrieves data in CSV format for the specified custom view in a Tableau workbook. *Note: the same limitation of get-view-data exists for this tool.* ([REST API][get-custom-view-data]) | All SKUs     |
| [get-custom-view-image](tools/views/get-custom-view-image.md)                                                         | Retrieves an image for a saved custom view ([REST API][get-custom-view-image])                                      | All SKUs     |
| [query-datasource](tools/data-qna/query-datasource.md)                                                                | Retrieves json formatted data from a published data source by executing VizQL Data Service requests ([VDS API][vds]) | All SKUs     |
| [list-all-pulse-metric-definitions](tools/pulse/list-all-pulse-metric-definitions.md)                                 | Lists all Pulse metric definitions on a specific Tableau Cloud site. ([Pulse API][pulse])                           | All SKUs     |
| [list-pulse-metric-definitions-from-definition-ids](tools/pulse/list-pulse-metric-definitions-from-definition-ids.md) | Lists the definition JSON object(s) from Metric Definition IDs ([Pulse API][pulse])                                 | All SKUs     |
| [list-pulse-metrics-from-metric-definition-id](tools/pulse/list-pulse-metrics-from-metric-definition-id.md)           | Lists Pulse metrics that are the children of a Metric Definition ID ([Pulse API][pulse])                            | All SKUs     |
| [list-pulse-metrics-from-metric-ids](tools/pulse/list-pulse-metrics-from-metric-ids.md)                               | Lists pulse metric metadata from its associated Metric IDs ([Pulse API][pulse])                                     | All SKUs     |
| [list-pulse-metric-subscriptions](tools/pulse/list-pulse-metric-subscriptions.md)                                     | List Pulse Metric Subscriptions for the current user ([Pulse API][pulse])                                           | All SKUs     |
| [generate-pulse-metric-value-insight-bundle](tools/pulse/generate-pulse-metric-value-insight-bundle.md)               | Generates a Pulse metric value insight bundle with insight types like period-over-period change, top contributors, bottom contributors, and more. See [Pulse API][pulse] and [insight types](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#insight-types) | All SKUs     |
| [generate-pulse-insight-brief](tools/pulse/generate-pulse-insight-brief.md)                                           | Generates an AI-powered Pulse [Insight Brief](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#EmbeddingsService_GenerateInsightBrief). | Tableau+ only     |
| [search-content](tools/content-exploration/search-content.md)                                                         | Searches for content in a Tableau site using Tableau's [search API][content-exploration] | All SKUs     |
| [list-extract-refresh-tasks](tools/tasks/list-extract-refresh-tasks.md)                                               | Admin-only. Retrieves a list of extract refresh tasks for the site ([REST API][list-extract-refresh-tasks])         | All SKUs     |
| [update-cloud-extract-refresh-task](tools/tasks/update-cloud-extract-refresh-task.md)                                 | Admin-only. Confirm-gated update of an extract refresh task schedule on Tableau Cloud ([REST API][update-cloud-extract-refresh-task]) | All SKUs     |
| [list-users](tools/users/list-users.md)                                                                               | Admin-only. Retrieves a list of users on the site ([REST API][list-users-api])                                      | All SKUs     |
| [update-user](tools/users/update-user.md)                                                                             | Admin-only. Confirm-gated update of a user's site role ([REST API][update-user-api])                               | All SKUs     |
| [query-admin-insights](tools/admin-insights/query-admin-insights.md)                                                 | Admin-only. Dispatches on `kind` to TS Events, Site Content, Job Performance, or stale-content report ([VDS API][vds]) | All SKUs     |
| [delete-content](tools/content/delete-content.md)                                                                     | Admin-only. Two-phase (preview/confirm) delete of a workbook, data source, or extract refresh task ([REST API][delete-workbook], [REST API][delete-datasource], [REST API][delete-extract-refresh-task]) | All SKUs     |

\* The `get-datasource-metadata` tool relies on both the VizQL Data Service and the Metadata API to get rich metadata about a data source. Only sites with Data Management entitlements will be able to execute the Metadata API calls, though the tool will remain functional without it.

[query]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
[list-workbooks]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
[list-projects]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects
[list-views]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site
[list-custom-views]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views
[list-flows]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flows_for_site
[get-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook
[get-flow]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow
[delete-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook
[delete-datasource]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source
[get-view-data]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data
[get-view-image]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
[get-custom-view-data]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_data
[get-custom-view-image]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_image
[meta]: https://help.tableau.com/current/api/metadata_api/en-us/index.html
[vds]: https://help.tableau.com/current/api/vizql-data-service/en-us/index.html
[pulse]: https://help.tableau.com/current/api/rest_api/en-us/REST/TAG/index.html#tag/Pulse-Methods
[content-exploration]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/TAG/index.html#tag/Content-Exploration-Methods
[list-extract-refresh-tasks]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks
[delete-extract-refresh-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task
[update-cloud-extract-refresh-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#update_cloud_extract_refresh_task
[list-users-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site
[update-user-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user

## Prompt List

Prompts orchestrate multiple tools into a guided admin workflow. They are gated behind the `ADMIN_TOOLS_ENABLED` site setting.

| **Prompt**                                                                    | **Description**                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [stale-content-cleanup-inform](prompts/stale-content-cleanup-inform.md)       | Admin-only. Read-only. Generates a stale-content report by calling `get-stale-content-report`.                          |
| [stale-content-cleanup-apply](prompts/stale-content-cleanup-apply.md)         | Admin-only. Destructive. Tags stale content, reports owners to notify, and — after a required human-confirmation break — deletes approved items to the recycle bin. |
| [job-optimization-inform](prompts/job-optimization-inform.md)                 | Admin-only. Read-only. Analyzes Admin Insights job performance and surfaces optimization signals.                       |
| [extract-optimization-apply](prompts/extract-optimization-apply.md)           | Admin-only. Destructive. Applies schedule downgrades and deletions to extract refresh tasks after a required human-confirmation break; defaults to a dry-run report. |
| [user-license-reclamation-inform](prompts/user-license-reclamation-inform.md) | Admin-only. Read-only. Identifies inactive licensed users who are candidates for downgrade to Unlicensed by cross-referencing `list-users` with TS Events activity. |
