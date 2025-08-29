---
sidebar_position: 1
---

# Introduction

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI-applications that integrate with Tableau.

## Key Features

- Provides access to Tableau published data sources through the
  [VizQL Data Service (VDS) API](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html).
- Supports collecting data source metadata (columns with descriptions) through the Tableau
  [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html).
- Supports access to Pulse Metric, Pulse Metric Definitions, Pulse Subscriptions, and Pulse Metric
  Value Insight Bundle through the [Pulse API][pulse].
- Usable by AI tools which support MCP Tools (e.g., Claude Desktop, Cursor and others).
- Works with any published data source on either Tableau Cloud or Tableau Server.

## Tool List

| **Variable**                                      | **Description**                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| list-datasources                                  | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])          |
| list-workbooks                                    | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])              |
| list-views                                        | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                      |
| list-fields                                       | Fetches field metadata (name, description) for the specified datasource ([Metadata API][meta])        |
| get-workbook                                      | Retrieves information on a workbook from a specified Tableau site ([REST API][get-workbook])          |
| get-view-data                                     | Retrieves data in CSV format for the specified view in a Tableau workbook ([REST API][get-view-data]) |
| get-view-image                                    | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])          |
| query-datasource                                  | Run a Tableau VizQL query ([VDS API][vds])                                                            |
| read-metadata                                     | Requests metadata for the specified data source ([VDS API][vds])                                      |
| list-all-pulse-metric-definitions                 | List All Pulse Metric Definitions ([Pulse API][pulse])                                                |
| list-pulse-metric-definitions-from-definition-ids | List Pulse Metric Definitions from Metric Definition IDs ([Pulse API][pulse])                         |
| list-pulse-metrics-from-metric-definition-id      | List Pulse Metrics from Metric Definition ID ([Pulse API][pulse])                                     |
| list-pulse-metrics-from-metric-ids                | List Pulse Metrics from Metric IDs ([Pulse API][pulse])                                               |
| list-pulse-metric-subscriptions                   | List Pulse Metric Subscriptions for Current User ([Pulse API][pulse])                                 |
| generate-pulse-metric-value-insight-bundle        | Generate Pulse Metric Value Insight Bundle ([Pulse API][pulse])                                       |

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
