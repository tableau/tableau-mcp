import { supportsDashboardVisualRegistration } from '../../../../desktop/externalApi/apiVersion.js';

type DashboardCreationPrerequisite = {
  required: boolean;
  status: 'blocked' | 'ready';
  kind: 'manual' | 'native';
  instructions: string[];
};

export function dashboardCreationPrerequisite(
  dashboardName: string,
  worksheetNames: string[],
  apiVersion?: string,
): DashboardCreationPrerequisite {
  if (supportsDashboardVisualRegistration(apiVersion)) {
    return {
      required: false,
      status: 'ready',
      kind: 'native',
      instructions: [
        'Finish applying every worksheet first; empty worksheet scaffolds cannot be added to a dashboard.',
        'Apply the dashboard through its document endpoint. Desktop creates missing views for referenced worksheets.',
        'Refresh both caches after worksheet apply and verify the dashboard layout and registrations in readback.',
      ],
    };
  }
  return {
    required: worksheetNames.length > 0,
    status: worksheetNames.length > 0 ? 'blocked' : 'ready',
    kind: 'manual',
    instructions: [
      'Finish applying every worksheet first; empty worksheet scaffolds cannot be added to a dashboard.',
      `In Tableau Desktop, drag each requested worksheet (${worksheetNames.join(', ')}) onto dashboard "${dashboardName}" to register its view.`,
      'There is no supported incremental registration API. Do not replace the workbook or inject viewpoints to bypass this step.',
      'After registration, refresh the workbook and dashboard caches and use the returned file paths for dashboard apply.',
    ],
  };
}
