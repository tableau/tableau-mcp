export function getPulseDisabledError(error: string): string {
  switch (error) {
    case 'tableau-server':
      return [
        'Pulse is not available on Tableau Server.',
        'Consider disabling the Pulse MCP tools in your client or removing them using the EXCLUDE_TOOLS environment variable.',
        'To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
      ].join(' ');
    case 'pulse-disabled':
      return [
        'Pulse is disabled on this Tableau Cloud site.',
        'To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
      ].join(' ');
    case 'datasource-not-allowed':
      return [
        'The set of allowed metric insights that can be queried is limited by the server configuration.',
        'One or more messages in the request contain only metrics derived from data sources that are not in the allowed set.',
      ].join(' ');
    default:
      return error;
  }
}
