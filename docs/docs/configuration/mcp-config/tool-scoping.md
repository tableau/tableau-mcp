---
sidebar_position: 5
---

# Tool Scoping

The Tableau MCP server can be configured to limit the scope of its tools to a set of data sources,
workbooks, views, projects, or tags.

Enabling tool scoping can cause:

1. Tools to return an error if they are called with arguments that are not within the allowed scope.
2. Tools to respond with results that have been filtered to only include content from the allowed
   scope.

## Examples use-cases

- Only allow clients to query a single data source with the
  [Query Data Source](../../tools/data-qna/query-datasource.md) tool. A client attempting to query
  any other data source will result in an error.
- Filter the results of the [List Workbooks](../../tools/workbooks/list-workbooks.md) tool to only
  include workbooks that exist in a single project. Workbooks from other projects will not be
  included in the results.

## Environment variables

The following optional environment variables can be used to configure the tool scoping.

### `INCLUDE_PROJECT_IDS`

A comma-separated list of project IDs by which to constrain tool arguments and results. Only data
sources and workbooks (or views from those workbooks) that are members of the provided projects can
be queried or will be included in the results of the tools. This variable is site and request
overridable, see [Site Settings](site-settings.md) and [Request Overrides](request-overrides.md).

- When set by the Tableau MCP server, cannot be empty.
- When overridden, can be empty to clear any bounds set by the Tableau MCP server.
- Project IDs can be determined using the
  [Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)
  REST API or by the [List Data Sources](../../tools/data-qna/list-datasources.md),
  [List Workbooks](../../tools/workbooks/list-workbooks.md), and
  [List Views](../../tools/views/list-views.md) tools (assuming tool scoping is disabled).
- Has no impact on the results of the Pulse-related tools.
- Checking a data source's project may require additional permissions. See
  [Data source permissions](#data-source-permissions).

Example: `d87d843b-4326-4ce3-bc50-a68c1e6c9ca5`

:::warning

To constrain the results of the [Search Content](../../tools/content-exploration/search-content.md)
tool by project, you must also provide the project ID found in the project's URL in the Explore
section of your Tableau site e.g. `861566` from
`https://10ax.online.tableau.com/#/site/my-site/projects/861566`

Example: `d87d843b-4326-4ce3-bc50-a68c1e6c9ca5,861566`

:::

<hr />

### `INCLUDE_DATASOURCE_IDS`

A comma-separated list of data source IDs by which to constrain tool arguments and results. Only
data sources or Pulse metrics and definitions derived from those data sources can be queried or will
be included in the results of the tools. This variable is site and request overridable, see
[Site Settings](site-settings.md) and [Request Overrides](request-overrides.md).

- When set, cannot be empty.
- When overridden, can be empty to clear any bounds set by the Tableau MCP server.
- Data source IDs can be determined using the
  [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  REST API or the [List Data Sources](../../tools/data-qna/list-datasources.md) tool (assuming tool
  scoping is disabled).
- Has no impact on tools that return information about workbooks or views.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d4`

<hr />

### `INCLUDE_WORKBOOK_IDS`

A comma-separated list of workbook IDs by which to constrain tool arguments and results. Only
workbooks or views from those workbooks can be queried or will be included in the results of the
tools. This variable is site and request overridable, see [Site Settings](site-settings.md) and
[Request Overrides](request-overrides.md).

- When set, cannot be empty.
- When overridden, can be empty to clear any bounds set by the Tableau MCP server.
- Workbook IDs can be determined using the
  [Query Workbooks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks)
  REST API or the [List Workbooks](../../tools/workbooks/list-workbooks.md) tool (assuming tool
  scoping is disabled). The [List Views](../../tools/views/list-views.md) tools also return workbook
  IDs.
- Has no impact on the results of the Pulse-related tools.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

<hr />

### `INCLUDE_VIEW_IDS`

A comma-separated list of view IDs by which to constrain tool arguments and results. Only the
specified views can be queried, fetched as images, or returned by listing tools. This variable is
site and request overridable, see [Site Settings](site-settings.md) and
[Request Overrides](request-overrides.md).

- When set, cannot be empty.
- When overridden, can be empty to clear any bounds set by the Tableau MCP server.
- View IDs can be determined using the
  [Query Views for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site)
  REST API or the [List Views](../../tools/views/list-views.md) tool (assuming tool scoping is
  disabled).
- For custom views, the underlying published view must be in this list.
- Has no impact on the results of the Pulse-related tools.

Example: `4d18c547-bbb1-4187-ae5a-7f78b35adf2d`

<hr />

### `INCLUDE_TAGS`

A comma-separated list of case-sensitive tags by which to constrain tool arguments and results. Only
data sources, workbooks, or views with the provided tags can be queried or will be included in the
results of the tools. This variable is site and request overridable, see
[Site Settings](site-settings.md) and [Request Overrides](request-overrides.md).

- When set, cannot be empty.
- When overridden, can be empty to clear any bounds set by the Tableau MCP server.
- Tags can be determined using the
  [Tableau product](https://help.tableau.com/current/pro/desktop/en-us/tags.htm) or the REST APIs
  for querying
  [data sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source),
  [workbooks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook),
  and
  [views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view).
- Has no impact on the results of the Pulse-related tools.
- Checking a data source's tags may require additional permissions. See
  [Data source permissions](#data-source-permissions).

Example: `sales,marketing`

## Publishing bounds and local files

For `publish-datasource` and project-based `publish-workbook`, `INCLUDE_PROJECT_IDS` limits the
destination project, including when `overwrite` is true. `INCLUDE_DATASOURCE_IDS`,
`INCLUDE_WORKBOOK_IDS`, and `INCLUDE_TAGS` constrain queries and listings; they do not restrict
which same-name item can be replaced by publishing in an allowed project. Tableau's publish and
overwrite permissions still apply. Use project bounds and Tableau permissions to control publishing
access. The caller's own Personal Space follows the separate rules in
[Publish Workbook](../../tools/workbooks/publish-workbook.md#personalspace).

Local publish paths use the MCP process's filesystem permissions. They are intended for trusted
clients or a separate server process and filesystem for each caller; they are not a per-caller
filesystem sandbox. Shared HTTP deployments must configure staged S3 uploads (`MCP_S3_BUCKET`)
before enabling authoring. With S3 enabled, both publishers reject local paths and accept only
staged upload IDs. Use OAuth or server-side authentication for staged uploads; Passthrough sessions
do not advertise the staged-upload tools, or the publish tools when S3 is enabled.

Both local and staged publishing accept at most **100 MiB (104857600 bytes)** per file. Publishing
still buffers the file, and S3 buffering and multipart upload can hold additional copies. Allow
several hundred MiB of process memory per concurrent publish, plus the server's normal memory, and
limit concurrency to fit the deployment's memory budget. This per-file cap is not a global memory
limit. Cancelling a request stops local/S3 file resolution; it does not undo a completed Tableau
publication.

## Data source permissions

When [`INCLUDE_PROJECT_IDS`](#include_project_ids) and/or [`INCLUDE_TAGS`](#include_tags) is set,
the Tableau MCP server checks a data source's project and/or tags before a tool can use it. It looks
these up with the
[Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
REST API, which requires the user to have **View** permission on the data source's parent project,
even though querying the data source itself does not.

If that request is denied due to missing permissions on the project, the server falls back to the
[Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html), which is only
available on Tableau Enterprise and Tableau Plus and if
[`DISABLE_METADATA_API_REQUESTS`](env-vars.md#disable_metadata_api_requests) is not set. Therefore,
if you are using project or tag based tool scoping, we recommend that your users have view access on
the projects where they have view access to the content in those projects.
