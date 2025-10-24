import { PulseDisabledError } from '../../sdks/tableau/methods/pulseMethods.js';

export function getPulseDisabledError(reason: PulseDisabledError): string {
  switch (reason) {
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
  }
}
