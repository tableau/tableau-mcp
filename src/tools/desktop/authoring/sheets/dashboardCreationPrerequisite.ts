type DashboardCreationPrerequisite = {
  required: boolean;
  status: 'blocked' | 'ready';
  kind: 'manual';
  instructions: string[];
};

/** Desktop has no incremental API for registering worksheet views in a new dashboard. */
export function dashboardCreationPrerequisite(
  dashboardName: string,
  worksheetNames: string[],
): DashboardCreationPrerequisite {
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
