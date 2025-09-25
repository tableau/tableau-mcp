---
sidebar_position: 1
---

# Introduction

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI applications that integrate with Tableau.

## Key Features

- Provides access to Tableau published data sources through the [VizQL Data Service (VDS) API][vds].
- Supports collecting data source metadata (columns with descriptions) through the Tableau [Metadata
  API][meta].
- Supports access to Pulse Metric, Pulse Metric Definitions, Pulse Subscriptions, and Pulse Metric
  Value Insight Bundle through the [Pulse API][pulse].
- Usable by AI tools which support MCP Tools (e.g., Claude Desktop, Cursor and others).
- Works with any published data source on either Tableau Cloud or Tableau Server.

## Tool List

| **Tool**                                                                                                              | **Description**                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [list-datasources](tools/data-qna/list-datasources.md)                                                                | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])          |
| [list-workbooks](tools/workbooks/list-workbooks.md)                                                                   | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])              |
| [list-views](tools/views/list-views.md)                                                                               | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                      |
| [get-datasource-metadata](tools/data-qna/get-datasource-metadata.md)                                                  | Fetches field metadata for the specified datasource ([Metadata API][meta] & [VDS API][vds])           |
| [get-workbook](tools/workbooks/get-workbook.md)                                                                       | Retrieves information on a workbook from a specified Tableau site ([REST API][get-workbook])          |
| [get-view-data](tools/views/get-view-data.md)                                                                         | Retrieves data in CSV format for the specified view in a Tableau workbook ([REST API][get-view-data]) |
| [get-view-image](tools/views/get-view-image.md)                                                                       | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])          |
| [query-datasource](tools/data-qna/query-datasource.md)                                                                | Run a Tableau VizQL query ([VDS API][vds])                                                            |
| [list-all-pulse-metric-definitions](tools/pulse/list-all-pulse-metric-definitions.md)                                 | List All Pulse Metric Definitions ([Pulse API][pulse])                                                |
| [list-pulse-metric-definitions-from-definition-ids](tools/pulse/list-pulse-metric-definitions-from-definition-ids.md) | List Pulse Metric Definitions from Metric Definition IDs ([Pulse API][pulse])                         |
| [list-pulse-metrics-from-metric-definition-id](tools/pulse/list-pulse-metrics-from-metric-definition-id.md)           | List Pulse Metrics from Metric Definition ID ([Pulse API][pulse])                                     |
| [list-pulse-metrics-from-metric-ids](tools/pulse/list-pulse-metrics-from-metric-ids.md)                               | List Pulse Metrics from Metric IDs ([Pulse API][pulse])                                               |
| [list-pulse-metric-subscriptions](tools/pulse/list-pulse-metric-subscriptions.md)                                     | List Pulse Metric Subscriptions for Current User ([Pulse API][pulse])                                 |
| [generate-pulse-metric-value-insight-bundle](tools/pulse/generate-pulse-metric-value-insight-bundle.md)               | Generate Pulse Metric Value Insight Bundle ([Pulse API][pulse])                                       |
| [search-content](tools/content-exploration/search-content.md)                                                         | Searches for content in a Tableau site ([Content Exploration API][content-exploration])               |

[query]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
[list-workbooks]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
[list-views]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site
[get-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook
[get-view-data]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data
[get-view-image]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
[meta]: https://help.tableau.com/current/api/metadata_api/en-us/index.html
[vds]: https://help.tableau.com/current/api/vizql-data-service/en-us/index.html
[pulse]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm
[content-exploration]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_content_exploration.htm