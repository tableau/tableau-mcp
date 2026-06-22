---
sidebar_position: 1
---

# Introduction

Tableau's official MCP Server. Helping Agents see and understand data.

## Key Features

- Provides access to Tableau published data sources through the [VizQL Data Service (VDS) API][vds].
- Supports collecting data source metadata (columns with descriptions) through the Tableau [Metadata
  API][meta].
- Supports access to Pulse Metric, Pulse Metric Definitions, Pulse Subscriptions, and Pulse Metric
  Value Insight Bundle through the [Pulse API][pulse].
- Usable by AI tools which support MCP Tools (e.g., Claude Desktop, Cursor and others).
- Works with any published data source on either Tableau Cloud or Tableau Server.

## Tool List

| **Tool**                                                                                                              | **Description**                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [list-datasources](tools/data-qna/list-datasources.md)                                                                | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])                        |
| [list-workbooks](tools/workbooks/list-workbooks.md)                                                                   | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])                            |
| [list-projects](tools/projects/list-projects.md)                                                                      | Retrieves a list of projects from a specified Tableau site ([REST API][list-projects])                              |
| [list-views](tools/views/list-views.md)                                                                               | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                                    |
| [list-custom-views](tools/views/list-custom-views.md)                                                                 | Retrieves a list of custom views for a specified Tableau workbook ([REST API][list-custom-views])                   |
| [get-datasource-metadata](tools/data-qna/get-datasource-metadata.md)                                                  | Fetches field metadata for the specified datasource ([Metadata API][meta] & [VDS API][vds])                         |
| [get-workbook](tools/workbooks/get-workbook.md)                                                                       | Retrieves information on a workbook from a specified Tableau site ([REST API][get-workbook])                        |
| [delete-workbook](tools/workbooks/delete-workbook.md)                                                                 | Admin-only. Two-phase (preview/confirm) delete of a workbook; recoverable via recycle bin ([REST API][delete-workbook]) |
| [delete-datasource](tools/data-qna/delete-datasource.md)                                                              | Admin-only. Two-phase (preview/confirm) delete of a published data source; warns on dependent workbooks/flows; recoverable via recycle bin ([REST API][delete-datasource]) |
| [get-view-data](tools/views/get-view-data.md)                                                                         | Retrieves data in CSV format for the specified view in a Tableau workbook ([REST API][get-view-data])               |
| [get-view-image](tools/views/get-view-image.md)                                                                       | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])                        |
| [get-custom-view-data](tools/views/get-custom-view-data.md)                                                           | Retrieves data in CSV format for the specified custom view in a Tableau workbook ([REST API][get-custom-view-data]) |
| [get-custom-view-image](tools/views/get-custom-view-image.md)                                                         | Retrieves an image for a saved custom view ([REST API][get-custom-view-image])                                      |
| [query-datasource](tools/data-qna/query-datasource.md)                                                                | Run a Tableau VizQL query ([VDS API][vds])                                                                          |
| [list-all-pulse-metric-definitions](tools/pulse/list-all-pulse-metric-definitions.md)                                 | List All Pulse Metric Definitions ([Pulse API][pulse])                                                              |
| [list-pulse-metric-definitions-from-definition-ids](tools/pulse/list-pulse-metric-definitions-from-definition-ids.md) | List Pulse Metric Definitions from Metric Definition IDs ([Pulse API][pulse])                                       |
| [list-pulse-metrics-from-metric-definition-id](tools/pulse/list-pulse-metrics-from-metric-definition-id.md)           | List Pulse Metrics from Metric Definition ID ([Pulse API][pulse])                                                   |
| [list-pulse-metrics-from-metric-ids](tools/pulse/list-pulse-metrics-from-metric-ids.md)                               | List Pulse Metrics from Metric IDs ([Pulse API][pulse])                                                             |
| [list-pulse-metric-subscriptions](tools/pulse/list-pulse-metric-subscriptions.md)                                     | List Pulse Metric Subscriptions for Current User ([Pulse API][pulse])                                               |
| [generate-pulse-metric-value-insight-bundle](tools/pulse/generate-pulse-metric-value-insight-bundle.md)               | Generate Pulse Metric Value Insight Bundle ([Pulse API][pulse])                                                     |
| [generate-pulse-insight-brief](tools/pulse/generate-pulse-insight-brief.md)                                           | Generate AI-powered Pulse Insight Brief (Discover) ([Pulse API][pulse])                                             |
| [search-content](tools/content-exploration/search-content.md)                                                         | Searches for content in a Tableau site ([Content Exploration API][content-exploration])                             |
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
