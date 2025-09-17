export function getPulseDisabledError(): string {
  return [
    'Pulse is disabled.',
    'To enable Pulse on your Tableau Cloud site, see the instuctions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
    'Pulse is not available on Tableau Server.',
  ].join(' ');
}
