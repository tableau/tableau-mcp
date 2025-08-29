---
sidebar_position: 1
---

# Configuring Tableau

Tableau MCP works with both Tableau Server and Tableau Cloud data with these prerequisites:

- Only published data sources are supported.
- VDS (VizQL Data Service) must be enabled (Tableau Server users may need to
  [enable it](https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm)).
- Metadata API must be enabled (Tableau Server users may need to
  [enable it](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html#enable-the-tableau-metadata-api-for-tableau-server)).
- You may need to
  [enable Tableau Pulse](https://help.tableau.com/current/online/en-us/pulse_set_up.htm) on your
  Tableau Cloud site to use [Pulse API][pulse] tools (Tableau Server is unable to use Tableau
  Pulse).

[pulse]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm
