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

