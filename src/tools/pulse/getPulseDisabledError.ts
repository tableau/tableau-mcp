export function getPulseDisabledError(reason: 'tableau-server' | 'pulse-disabled'): string {
  switch (reason) {
    case 'tableau-server':
      return [
        'Pulse is not available on Tableau Server.',
        'These tools are only available on Tableau Cloud.',
        'To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
      ].join(' ');
    case 'pulse-disabled':
      return [
        'Pulse is disabled on this Tableau Cloud site or not enabled for a group to which you belong.',
        'To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
      ].join(' ');
  }
}
