---
sidebar_position: 6
---

# Tool Scoping

The Tableau MCP server can be configured to limit the scope of its tools to a set of data sources,
workbooks, or projects. This applies both to:

1. Tools that query a specific data source, workbook, or view e.g. the
   [Query Data Source](../../tools/data-qna/query-datasource.md) tool, and
2. Tools that return a list of that content e.g. the
   [List Data Sources](../../tools/data-qna/list-datasources.md) tool.

## Examples use-cases

- Only allow clients to query a single data source with the
  [Query Data Source](../../tools/data-qna/query-datasource.md) tool. A client attempting to query
  any other data source will result in an error.
- Scope the results of the [List Workbooks](../../tools/workbooks/list-workbooks.md) tool to only
  workbooks that exist in a single project. A client calling this tool will only see workbooks that
  exist in that project in its results.

## Environment variables

The following environment variables can be used to configure the tool scoping. They are all
optional.

## `INCLUDE_PROJECT_IDS`

A comma-separated list of project IDs by which to constrain tool arguments and results. Only data
sources and workbooks (or views from those workbooks) that are members of the provided projects can
be queried or will be included in the results of the tools.

- When set, cannot be empty.
- Project IDs can be determined using the
  [Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)
  REST API or by the [List Data Sources](../../tools/data-qna/list-datasources.md),
  [List Workbooks](../../tools/workbooks/list-workbooks.md), and
  [List Views](../../tools/views/list-views.md) tools (assuming tool scoping is disabled).

Example: `d87d843b-4326-4ce3-bc50-a68c1e6c9ca5`

:::warning

To constrain the results of the [Search Content](../../tools/content-exploration/search-content.md)
tool by project, you must also provide the project ID found in the project's URL in the Explore
section of your Tableau site e.g. `861566` from
`https://10ax.online.tableau.com/#/site/my-site/projects/861566`

Example: `d87d843b-4326-4ce3-bc50-a68c1e6c9ca5,861566`

:::

<hr />

## `INCLUDE_DATASOURCE_IDS`

A comma-separated list of data source IDs by which to constrain tool arguments and results. Only
data sources or Pulse metrics and definitions derived from those data sources can be queried or will
be included in the results of the tools.

- When set, cannot be empty.
- Data source IDs can be determined using the
  [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  REST API or the [List Data Sources](../../tools/data-qna/list-datasources.md) tool (assuming tool
  scoping is disabled).

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d4`

<hr />

## `INCLUDE_WORKBOOK_IDS`

A comma-separated list of workbook IDs by which to constrain tool arguments and results. Only
workbooks or views from those workbooks can be queried or will be included in the results of the
tools.

- When set, cannot be empty.
- Workbook IDs can be determined using the
  [Query Workbooks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks)
  REST API or the [List Workbooks](../../tools/workbooks/list-workbooks.md) tool (assuming tool
  scoping is disabled). The [List Views](../../tools/views/list-views.md) tools also return workbook
  IDs.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

<hr />

<hr />

[cors]: https://expressjs.com/en/resources/middleware/cors.html#configuration-options
