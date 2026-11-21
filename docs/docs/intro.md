---
sidebar_position: 1
---

# Introduction

Tableau's official MCP Server. Helping *agents* see and understand data. And as of the %coming_release% release, the MCP helps them author visualizations of data.

> Running more than one Tableau MCP server, or seeing a confusing "not configured"/`401` error?
> See [Running Multiple Servers & Diagnosing Auth Errors](configuration/mcp-config/multiple-servers.md).

## Headless Tableau 

Headless Tableau is using Tableau services without the Tableau user interface. Tableau authentication, governance, permissions, and other features remain available. Headless use cases include workflow automation and accessing data in Tableau data sources directly.  

Any agent that supports MCP can now also use Tableau MCP in a headless workflow where the agent drives Tableau services through APIs. These services include administration, data and metadata access, and authoring API services. 

### Tableau Service Calls for Agents

[**Web Tools**](./category/web-tools) of the MCP combine the capabilities of [Tableau REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref.htm), [Tableau VizQL Data Service](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html), and [Tableau Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html) services. Using these tools you can:

> Chat with your data: Reuse your trusted, curated data models to answer ad-hoc questions that are grounded on your pre-built data semantics and metadata. 

> Find insights from pre-built data artifacts: Enable agents to query your published workbooks and extract data, images, custom views and more. 

> Discover and analyze Pulse metrics: Bring 100% accuracy and deterministic AI to any agent by using Pulse metric definitions and the Pulse insights engine.

> Manage and administer your Tableau environment.

### Tableau Authoring for Agents

[**Desktop Tools**](./category/desktop-tools), [expertise and authoring engine](tableau-authoring/index.md), are added in the %coming_release% release. With this addition you can use natural language and agent capabilities to query, create, and modify Tableau workbooks and extensions. 

Authoring features of this MCP are released in concert with [Tableau Studio](ext://studio), an evolution of Tableau Desktop for the agentic age. These enable you to:

- In %product_name%: Use natural language in the [Tableau Agent](ext://studio/get-started-with-tableau-agent.html), a tightly integrated Tableau MCP harness present in Tableau Studio. 
- Headless: Use natural language in the [agent of your choice](ext://studio/use-tableau-studio-headless.html) and the MCP will control Tableau Studio through its [External Client API](ext://eca).
- Headless: Call the External Client API directly using its REST endpoints.
- [Customize the authoring expertise](ext://studio/customize-tableau-agent.html) to reflect your needs and standards.

Using these tools and expertise, you can:

> Create a workbook from a verbal description 

> Model a Tableau data source and curate its metadata

> Apply a template or compliance rules to an existing workbook 

> Create a viz or dashboard extension

> Make batch processing tools

> Mechanize compliance checking and correction
 


## How Do I Use Tableau MCP?
### Tableau MCP is open source 

The <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="GitHub" style={{verticalAlign: 'text-bottom'}}><path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg> [Tableau MCP](https://github.com/tableau/tableau-mcp) repo is an open source GitHub project that uses the
[Model Context Protocol](https://modelcontextprotocol.io/introduction) standard for simplifying
agent-to-Tableau communication, enabling users to bring their Tableau data into AI tools. This MCP server can be used with any Tableau edition on Cloud or Server, though specific tools may be gated by SKU. 

Follow along and share ideas with the Tableau MCP team by creating issues or discussions on the
repository. You can also join the [Tableau Developer Platform](https://www.tableau.com/developer) and reach out in the [#tableau-ai-solutions](https://tableau-datadev.slack.com/archives/C07LMAVG4N6) Slack channel in the Tableau #DataDev workspace.

### Tableau MCP for Tableau Cloud

Tableau MCP is also a managed service on every Tableau Cloud pod, and it is accessible over the URL: `https://mcp.tableau.com`. See [Hosted Tableau MCP](hosted-tableau-mcp) for more details.

### Customizing the authoring experience

Customizing standard knowledge and skills and adding your own in a local fork is in progress for the %coming_release% release.

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

Flow tools are grouped by operation: GET, LIST, then RUN.

| **Tool**                                                                                                              | **Description**                                                                                                     | **SKU**      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| [list-datasources](tools/data-qna/list-datasources.md)                                                                | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])                        | All SKUs     |
| [list-workbooks](tools/workbooks/list-workbooks.md)                                                                   | Retrieves a list of workbooks from a specified Tableau site ([REST API][list-workbooks])                            | All SKUs     |
| [list-projects](tools/projects/list-projects.md)                                                                      | Retrieves a list of projects from a specified Tableau site ([REST API][list-projects])                              | All SKUs     |
| [list-views](tools/views/list-views.md)                                                                               | Retrieves a list of views from a specified Tableau site ([REST API][list-views])                                    | All SKUs     |
| [list-custom-views](tools/views/list-custom-views.md)                                                                 | Retrieves a list of custom views for a specified Tableau workbook ([REST API][list-custom-views])                   | All SKUs     |
| [get-datasource-metadata](tools/data-qna/get-datasource-metadata.md)                                                  | Fetches datasource metadata including table relationships, datasource and field descriptions, field roles and types, calculation strings, and parameters for the specified datasource ([Metadata API][meta] & [VDS API][vds])                         | All SKUs\*   |
| [get-workbook](tools/workbooks/get-workbook.md)                                                                       | Retrieves information about a workbook for a specified workbook on a Tableau site ([REST API][get-workbook])                        | All SKUs     |
| [download-workbook](tools/workbooks/download-workbook.md)                                                             | Downloads workbook content as TWB (XML) or TWBX (packaged) and returns a file link ([REST API][download-workbook])                 | All SKUs     |
| [get-flow](tools/flows/get-flow.md)                                                                                   | Retrieves information on a Tableau Prep flow including output steps and recent runs ([REST API][get-flow])                          | All SKUs     |
| [describe-flow](tools/flows/describe-flow.md)                                                                         | Summarizes a Tableau Prep flow's design — inputs, outputs, steps, lineage, and connections ([REST API][describe-flow])               | All SKUs     |
| [get-flow-task](tools/flows/get-flow-task.md)                                                                         | Retrieves a single scheduled flow run task by id ([REST API][get-flow-task])                                        | All SKUs     |
| [list-flows](tools/flows/list-flows.md)                                                                               | Retrieves a list of Tableau Prep flows from a specified Tableau site ([REST API][list-flows])                       | All SKUs     |
| [list-flow-runs](tools/flows/list-flow-runs.md)                                                                       | Retrieves the run history (executions) of Tableau Prep flows on a site ([REST API][list-flow-runs])                                 | All SKUs     |
| [list-flow-tasks](tools/flows/list-flow-tasks.md)                                                                     | Retrieves the scheduled flow run tasks (schedules) for Tableau Prep flows on a site ([REST API][list-flow-tasks])                   | All SKUs     |
| [run-flow](tools/flows/run-flow.md)                                                                                   | Mutating tool with preview and confirmation. Runs a Tableau Prep flow on demand, returning the async job ([REST API][run-flow-now])        | All SKUs     |
| [run-flow-task](tools/flows/run-flow-task.md)                                                                         | Mutating tool with preview and confirmation. Runs an existing scheduled flow run task now, returning the async job ([REST API][run-flow-task]) | All SKUs     |
| [cancel-flow-run](tools/flows/cancel-flow-run.md)                                                                     | Mutating tool with preview and confirmation. Requests cancellation of a queued or in-progress flow run by flow run id; poll for the final status ([REST API][cancel-flow-run]) | All SKUs     |
| [delete-content](tools/content/delete-content.md)                                                                     | Admin-only. Two-phase (preview/confirm) delete of a workbook, data source, or extract refresh task; workbook/data source deletes need Admin Insights (Tableau Cloud) ([REST API][delete-workbook], [REST API][delete-datasource], [REST API][delete-extract-refresh-task]) | All SKUs     |
| [get-view-data](tools/views/get-view-data.md)                                                                         | Retrieves data for the specified view in a Tableau workbook. Tableau REST API 3.30 and later returns all server-exported sheet parts; earlier versions return CSV for the requested worksheet, or the first worksheet of a dashboard. ([REST API][get-view-data])               | All SKUs     |
| [get-view-image](tools/views/get-view-image.md)                                                                       | Retrieves an image for the specified view in a Tableau workbook ([REST API][get-view-image])                        | All SKUs     |
| [get-custom-view-data](tools/views/get-custom-view-data.md)                                                           | Retrieves CSV data for the specified custom view in a Tableau workbook. A dashboard-based custom view returns its first worksheet. ([REST API][get-custom-view-data]) | All SKUs     |
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
| [list-groups](tools/users/list-groups.md)                                                                             | Admin-only. Retrieves a list of groups on the site ([REST API][list-groups-api])                                    | All SKUs     |
| [update-user](tools/users/update-user.md)                                                                             | Admin-only. Confirm-gated update of a user's site role ([REST API][update-user-api])                               | All SKUs     |
| [query-admin-insights](tools/admin-insights/query-admin-insights.md)                                                 | Admin-only. Dispatches on `kind` to TS Events, TS Users, Site Content, Job Performance, or stale-content report ([VDS API][vds]) | All SKUs     |
| [query-knowledge-context](tools/knowledge/query-knowledge-context.md)                                                | Queries governed definitions, relationships, lineage, impact, and graph sources through one read-only tool | Tableau+ only |
| [inspect-knowledge-context](tools/knowledge/inspect-knowledge-context.md)                                            | Inspects graph status, semantic context, health, and improvement suggestions without changing the graph | Tableau+ only |
| [manage-knowledge-context](tools/knowledge/manage-knowledge-context.md)                                              | Creates, updates, or deletes customer-governed semantic context | Tableau+ only |
| [delete-content](tools/content/delete-content.md)                                                                     | Admin-only. Two-phase (preview/confirm) delete of a workbook, data source, or extract refresh task; workbook/data source deletes need Admin Insights (Tableau Cloud) ([REST API][delete-workbook], [REST API][delete-datasource], [REST API][delete-extract-refresh-task]) | All SKUs     |
| [scaffold-data-app](tools/data-apps/scaffold-data-app.md)                                                             | Disabled by default (`data-apps` feature flag). Scaffolds a starter Tableau data app workspace and requires a site allowed-origins API lookup                                                      | All SKUs     |

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
[download-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#download_workbook
[get-flow]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow
[list-flow-runs]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_runs
[list-flow-tasks]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_tasks
[describe-flow]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm
[delete-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook
[delete-datasource]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source
[query-workbooks-for-site]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
[query-datasources]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
[delete-tag-from-workbook]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_tag_from_workbook
[delete-tag-from-datasource]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_tag_from_data_source
[get-flow-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_task
[run-flow-now]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#run_flow_now
[run-flow-task]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#run_flow_task
[cancel-flow-run]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#cancel_flow_run
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
[list-groups-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_groups_on_site
[list-users-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site
[update-user-api]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user

## Prompt List

Prompts orchestrate multiple tools into a guided admin workflow. They are gated behind the `ADMIN_TOOLS_ENABLED` site setting.

Prompts are user-invoked (for example, as a slash command). So that the model can also reach a workflow on its own, each enabled prompt is also served as a read-only MCP resource at `tableau-mcp://admin-workflows/<prompt-name>`, whose text is the prompt rendered with its default arguments. Destructive `-apply` workflows keep their dry-run and human-in-the-loop confirmation steps either way.

| **Prompt**                                                                    | **Description**                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [stale-content-cleanup-inform](prompts/stale-content-cleanup-inform.md)       | Admin-only. Read-only. Generates a stale-content report by calling `query-admin-insights` with `kind: "stale-content"`. |
| [stale-content-cleanup-apply](prompts/stale-content-cleanup-apply.md)         | Admin-only. Destructive. Tags stale content, reports owners to notify, and — after a required human-confirmation break — deletes approved items to the recycle bin. |
| [job-optimization-inform](prompts/job-optimization-inform.md)                 | Admin-only. Read-only. Analyzes Admin Insights job performance and surfaces optimization signals.                       |
| [extract-optimization-apply](prompts/extract-optimization-apply.md)           | Admin-only. Destructive. Applies schedule downgrades and deletions to extract refresh tasks after a required human-confirmation break; defaults to a dry-run report. |
| [user-license-reclamation-inform](prompts/user-license-reclamation-inform.md) | Admin-only. Read-only. Identifies inactive licensed users who are candidates for downgrade to Unlicensed by cross-referencing `list-users` with TS Events activity. |
| [user-license-reclamation-apply](prompts/user-license-reclamation-apply.md)   | Admin-only. Destructive. Identifies inactive licensed users, surfaces owned-content counts, and — after a required human-confirmation break — downgrades approved users to Unlicensed; defaults to a dry-run report. |
