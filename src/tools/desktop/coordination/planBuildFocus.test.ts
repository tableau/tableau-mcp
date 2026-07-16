import {
  isPlanBuildWorksheet,
  markPlanBuildWorksheets,
  resetPlanBuildWorksheets,
} from './planBuildFocus.js';

afterEach(() => resetPlanBuildWorksheets());

// Compose-focus seam (a2td #215 port): focus-suppression is scoped to multi-task plans.
describe('plan-build focus ownership (internal seam)', () => {
  it('standalone worksheet (no plan recorded) is NOT focus-suppressed', () => {
    expect(isPlanBuildWorksheet('session-1', 'Sales by State')).toBe(false);
  });

  it('a worksheet recorded by a plan IS focus-suppressed; others / other sessions are not', () => {
    markPlanBuildWorksheets('session-1', ['Revenue Bar', 'Revenue KPI']);

    expect(isPlanBuildWorksheet('session-1', 'Revenue Bar')).toBe(true);
    expect(isPlanBuildWorksheet('session-1', '  Revenue KPI  ')).toBe(true); // trimmed match
    expect(isPlanBuildWorksheet('session-1', 'Not In Plan')).toBe(false);
    expect(isPlanBuildWorksheet('other-session', 'Revenue Bar')).toBe(false); // session-scoped
  });

  it('trims recorded names so a padded plan name still matches an unpadded apply', () => {
    markPlanBuildWorksheets('session-1', ['  Padded Sheet  ']);
    expect(isPlanBuildWorksheet('session-1', 'Padded Sheet')).toBe(true);
  });

  it('reset clears all recorded ownership', () => {
    markPlanBuildWorksheets('session-1', ['Revenue Bar']);
    resetPlanBuildWorksheets();
    expect(isPlanBuildWorksheet('session-1', 'Revenue Bar')).toBe(false);
  });

  // Disclosed residual (a2td #215): a later plan for the same session OVERWRITES the set.
  // Names dropped from the new plan stop being suppressed; there is no per-apply eviction, so
  // names that stay in the new plan remain suppressed until re-plan/restart.
  it('re-planning a session overwrites the previous set (drops stale names, keeps re-listed ones)', () => {
    markPlanBuildWorksheets('session-1', ['Old Only', 'Shared']);
    markPlanBuildWorksheets('session-1', ['Shared', 'New Only']);

    expect(isPlanBuildWorksheet('session-1', 'Old Only')).toBe(false); // dropped by re-plan
    expect(isPlanBuildWorksheet('session-1', 'Shared')).toBe(true); // still in the new plan
    expect(isPlanBuildWorksheet('session-1', 'New Only')).toBe(true); // added by re-plan
  });
});
