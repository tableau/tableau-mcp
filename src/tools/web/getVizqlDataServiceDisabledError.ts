export function getVizqlDataServiceDisabledError(): string {
  return [
    'The VizQL Data Service is disabled on this Tableau Server.',
    'To enable it, use TSM using the instructions at https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm.',
  ].join(' ');
}

// Hedged hint appended to the VDS-disabled message on REST API < 3.30. The disabled-VDS branch fires
// for any 404 from the VDS query endpoint and query-datasource can't tell whether the target is
// embedded, so this is phrased as an additional possibility ("can also occur"), never a replacement.
export function getEmbeddedDatasourceVersionHint(): string {
  return 'This can also occur when querying an embedded (workbook) datasource on Tableau Server REST API versions below 3.30, which do not support embedded datasource queries. Published datasources are unaffected.';
}
