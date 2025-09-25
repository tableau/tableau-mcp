---
sidebar_position: 1
---

# Configuring Tableau

Tableau MCP works with both Tableau Server and Tableau Cloud data with these prerequisites:

- Only published data sources are supported.
- VDS (VizQL Data Service) must be enabled (Tableau Server users may need to [enable it][vds]).
- VDS requires that the user also have API Access permission [enabled][api-access].
- Metadata API must be enabled (Tableau Server users may need to [enable it][metadata]).
- You may need to [enable Tableau Pulse][pulse] on your Tableau Cloud site to use the
  [Pulse tools](../category/pulse) (Tableau Server is unable to use Tableau Pulse).

[pulse]: https://help.tableau.com/current/online/en-us/pulse_set_up.htm
[vds]:
  https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm
[api-access]:
  https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_configuration.html
[metadata]:
  https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html#enable-the-tableau-metadata-api-for-tableau-server
