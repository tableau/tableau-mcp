---
sidebar_position: 1
---

# Configuring Tableau

Tableau MCP is a bridge between an AI agent and your Tableau Platform (APIs). It works with both Tableau Server and Tableau Cloud, but its capabilities are determined by the availability of the underlying Tableau services that the MCP tools depend on, and by an individual user's ability to access them. To get the most out of Tableau MCP, we recommend the following:

- Ensure VDS (VizQL Data Service) is enabled (Tableau Server users may need to [enable it][vds]) and users have the API Access permission [enabled][api-access] on the data sources they intend to query.
- Data Catalog is enabled for accessing the Metadata API to ground agents on the metadata and lineage of data sources and content. (Tableau Server users may need to [enable it][metadata]).
- Tableau Pulse's AI capabilities [are enabled](https://help.tableau.com/current/online/en-us/pulse_set_up.htm). Tableau Server is unable to use Tableau Pulse at this time.

[vds]:
  https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm
[api-access]:
  https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_configuration.html
[metadata]:
  https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html#enable-the-tableau-metadata-api-for-tableau-server
