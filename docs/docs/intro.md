---
sidebar_position: 1
---

# Introduction

Tableau's official MCP Server. Helping Agents see and understand data.


[Tableau MCP](https://github.com/tableau/tableau-mcp) is an open source GitHub project that uses the
[Model Context Protocol](https://modelcontextprotocol.io/introduction) standard for simplifying
agent-to-Tableau communication, enabling users to bring their Tableau data into AI tools. This MCP server can be used with any Tableau edition on Cloud or Server, though specific tools may be gated by SKU. For more information on what is available across editions and hosting environment see: [ADD link!]

## Use Cases

- Chat with your data: Reuse your trusted, curated data models to answer ad-hoc questions that are grounded on your pre-built data semantics and metadata. 
- Find insights from pre-built data artifacts: Enable agents to query your published workbooks and extract data, images, custom views and more. 
- Discover and analyze Pulse metrics: Bring 100% accuracy and deterministic AI to any agent by leveraging pulse metric definitions and the pulse insights engine. 

### Coming soon! 
- Prepare your data and manage prep flows.
- Manage and Adminster your Tableau environment with admin-focused tools.
- Collaboratively or Autonomously build Tableau workbooks: Leverage new tools and skills that allow local coding agents to directly work with and take action on Tableau desktop. Drag and drop your way to insights or let an agent do it for you! 


## Tool List

| **Tool**                                                                                                              | **Description**                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [list-datasources](tools/data-qna/list-datasources.md)                                                                | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])                        |
| [list-workbooks](tools/workbooks/list-workbooks.md)                                                                   | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])                            |
| [list-projects](tools/projects/list-projects.md)                                                                      | Retrieves a list of projects from a specified Tableau site ([REST API][list-projects])                              |
| [list-views](tools/views/list-views.md)                                                                               | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                                    |
| [list-custom-views](tools/views/list-custom-views.md)                                                                 | Retrieves a list of custom views for a specified Tableau workbook ([REST API][list-custom-views])                   |
| [get-datasource-metadata](tools/data-qna/get-datasource-metadata.md)                                                  | Fetches datasource metadata including table relationships, datasource and field descriptions, field roles and types, calculation strings, and parameters for the specified datasource ([Metadata API][meta] & [VDS API][vds])                         |
| [get-workbook](tools/workbooks/get-workbook.md)                                                                       | Retrieves information about a workbook for a specified workbook on a Tableau site ([REST API][get-workbook])                        |
| [delete-workbook](tools/workbooks/delete-workbook.md)                                                                 | Admin-only. Two-phase (preview/confirm) delete of a workbook; recoverable via recycle bin ([REST API][delete-workbook]) |
| [delete-datasource](tools/data-qna/delete-datasource.md)                                                              | Admin-only. Two-phase (preview/confirm) delete of a published data source; warns on dependent workbooks/flows; recoverable via recycle bin ([REST API][delete-datasource]) |
| [get-view-data](tools/views/get-view-data.md)                                                                         | Retrieves data in CSV format for the specified view in a Tableau workbook. *Note: the get-view-data api currently has a limitation that when used on a dashboard sheet type, it will only return data for the first worksheet in the dashboard. This will be fixed starting in 26.3.*([REST API][get-view-data])               |
| [get-view-image](tools/views/get-view-image.md)                                                                       | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])                        |
| [get-custom-view-data](tools/views/get-custom-view-data.md)                                                           | Retrieves data in CSV format for the specified custom view in a Tableau workbook. *Note: the same limitation of get-view-data exists for this tool.* ([REST API][get-custom-view-data]) |
| [get-custom-view-image](tools/views/get-custom-view-image.md)                                                         | Retrieves an image for a saved custom view ([REST API][get-custom-view-image])                                      |
| [query-datasource](tools/data-qna/query-datasource.md)                                                                | Retrieves json formatted data from a published data source by executing VizQL Data Service requests ([VDS API][vds])                                                                          |
| [list-all-pulse-metric-definitions](tools/pulse/list-all-pulse-metric-definitions.md)                                 | Lists all Pulse metric definitions on a specific tableau cloud site. ([Pulse API][pulse])                                                              |
| [list-pulse-metric-definitions-from-definition-ids](tools/pulse/list-pulse-metric-definitions-from-definition-ids.md) | Lists the definition JSON object(s) from Metric Definition IDs ([Pulse API][pulse])                                       |
| [list-pulse-metrics-from-metric-definition-id](tools/pulse/list-pulse-metrics-from-metric-definition-id.md)           | Lists Pulse metrics that are the children of a Metric Definition ID ([Pulse API][pulse])                                                   |
| [list-pulse-metrics-from-metric-ids](tools/pulse/list-pulse-metrics-from-metric-ids.md)                               | Lists pulse metric metadata from its associated Metric IDs ([Pulse API][pulse])                                                             |
| [list-pulse-metric-subscriptions](tools/pulse/list-pulse-metric-subscriptions.md)                                     | List Pulse Metric Subscriptions for the current user ([Pulse API][pulse])                                               |
| [generate-pulse-metric-value-insight-bundle](tools/pulse/generate-pulse-metric-value-insight-bundle.md)               | Generates a Pulse metric value insight bundle with insight types like period-over-period change, top contributers, bottom contributiors, and more. See [Pulse API][pulse] and [insight types](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#insight-types)                                                   |
| [generate-pulse-insight-brief](tools/pulse/generate-pulse-insight-brief.md)                                           | Generates an  AI-powered Pulse [Insight Brief](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#EmbeddingsService_GenerateInsightBrief).                                          |
| [search-content](tools/content-exploration/search-content.md)                                                         | Searches for content in a Tableau site using Tableau's [search API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_content_exploration.htm#ContentExplorationService_getSearch)                 |
| [list-extract-refresh-tasks](tools/tasks/list-extract-refresh-tasks.md)                                               | Admin-only. Retrieves a list of extract refresh tasks for the site ([REST API][list-extract-refresh-tasks])          |
| [delete-extract-refresh-task](tools/tasks/delete-extract-refresh-task.md)                                             | Admin-only. Deletes an extract refresh task ([REST API][delete-extract-refresh-task])                                |
| [update-cloud-extract-refresh-task](tools/tasks/update-cloud-extract-refresh-task.md)                                 | Admin-only. Updates the schedule of an extract refresh task on Tableau Cloud ([REST API][update-cloud-extract-refresh-task]) |
| [list-users](tools/users/list-users.md)                                                                              | Admin-only. Retrieves a list of users on the site ([REST API][list-users-api])                                      |
| [query-admin-insights-ts-events](tools/admin-insights/query-admin-insights-ts-events.md)                              | Admin-only. Issues a VDS query against the Admin Insights `TS Events` datasource ([VDS API][vds])                   |
| [query-admin-insights-site-content](tools/admin-insights/query-admin-insights-site-content.md)                        | Admin-only. Issues a VDS query against the Admin Insights `Site Content` datasource ([VDS API][vds])                |
| [query-admin-insights-job-performance](tools/admin-insights/query-admin-insights-job-performance.md)                  | Admin-only. Issues a VDS query against the Admin Insights `Job Performance` datasource ([VDS API][vds])             |
| [get-stale-content-report](tools/admin-insights/get-stale-content-report.md)                                          | Admin-only. Deterministic stale-content report from `Site Content` ([VDS API][vds])                                 |

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
[get-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook
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
[pulse]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm
[content-exploration]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_content_exploration.htm
[list-extract-refresh-tasks]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks
[delete-extract-refresh-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task
[update-cloud-extract-refresh-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#update_cloud_extract_refresh_task
[list-users-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site

## Prompt List

Prompts orchestrate multiple tools into a guided admin workflow. They are gated behind the `ADMIN_TOOLS_ENABLED` feature flag.

| **Prompt**                                                                    | **Description**                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [stale-content-cleanup-inform](prompts/stale-content-cleanup-inform.md)       | Admin-only. Read-only. Generates a stale-content report by calling `get-stale-content-report`.                          |
| [stale-content-cleanup-apply](prompts/stale-content-cleanup-apply.md)         | Admin-only. Destructive. Tags stale content, reports owners to notify, and — after a required human-confirmation break — deletes approved items to the recycle bin. |
| [job-optimization-inform](prompts/job-optimization-inform.md)                 | Admin-only. Read-only. Analyzes Admin Insights job performance and surfaces optimization signals.                       |
