export function getVizqlDataServiceDisabledError(): string {
  return [
    'The VizQL Data Service is disabled on this Tableau Server.',
    'To enable it, use TSM using the instructions at https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm.',
  ].join(' ');
}
