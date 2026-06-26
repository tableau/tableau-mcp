---
sidebar_position: 2
---

# Popular Client Integrations
This guide walks you through everything you need to leverage Tableau MCP through popular 3rd-party agents.

## Claude Product Suite
### Tableau Connector for Claude and Cowork
Coming soon! 

### Claude Desktop Extension
*The Tableau Extension for Claude Desktop does not actually use the hosted service. Instead, like all Claude desktop extensions, it is a bundle that contains all the tableau mcp code and depencies in a single `.mcpb` package. It uses Claude desktop's native node.js runtime. To use the Tableau extension, you must have installed [Claude Desktop](https://claude.ai/download)*

#### Step 1: create a Personal Access Token (PAT)

Login to your site, then click your profile in the upper right to bring up My Account Settings.

Scroll down to Personal Access Tokens and create a new one. You can use any token name but something
memorable like "mcp" is suggested to make later configuraton easier. Make sure to copy and save the
value because it's only shown this one time. (Also, be aware that, by default, Tableau PATs will expire after 15
days of inactivity, so you may need to periodically create a new one.)

![Personal Access Token Config](../getting-started/images/pat.png)

:::warning

Keep your PAT safe and don't share with anyone or check into source control. Pay attention to the
expiration date. You can also return here to revoke the token when you no longer need it.

:::

Make note of these 4 values which you'll need later for the MCP configuration:

- SERVER (e.g. https://10ax.online.tableau.com or https://tableau.example.com)
- SITE_NAME (e.g. techandprod; on Server leave blank to use the default site)
- PAT_NAME (e.g. mcp)
- PAT_VALUE (value copied after PAT creation)

#### Step 2: Install Tableau MCP Extension

Option 1: Install from Claude Marketplace

1. Open Claude Desktop
2. Go to Settings | Extensions
3. Click on Browse Extensions
4. Search for Tableau and install it

Option 2: Install latest from Tableau MCP GitHub

1. Go to the [Releases page](https://github.com/tableau/tableau-mcp/releases)
2. For the newest release, under Assets, find and download the .mcpb file (it will be named
   something like "tableau-mcp-v1.15.0.mcpb")
3. Open Claude Desktop
4. Go to Settings | Extensions
5. Drag and drop the .mcpb file onto Claude Desktop

Once the extension is installed, you'll be prompted to configure Tableau MCP:

- SERVER
  - Cloud: pod hostname like https://10ax.online.tableau.com
  - Server: hostname like https://tableau.example.com
- SITE_NAME
  - Cloud: required, for example techandprod
  - Server: site name, or can leave blank to use the default site
- PAT_NAME (e.g. mcp)
  - The name of the PAT you created in the Tableau site settings
- PAT_VALUE (value copied after PAT creation above)

When everything is configured it should look like this:

![Claude Desktop Extension configuration](../getting-started/images/dxt-config.png)