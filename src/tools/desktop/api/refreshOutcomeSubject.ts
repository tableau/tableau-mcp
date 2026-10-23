import { DashboardRefreshOutcome } from '../../../desktop/externalApi/types.js';

/** Headline for a completed refresh whose outcome is not a clean COMPLETE; undefined when clean. */
export function nonCleanRefreshSubject(
  scope: string,
  outcome: DashboardRefreshOutcome | undefined,
): string | undefined {
  if (outcome === undefined || (outcome.outcome === 'COMPLETE' && outcome.failed.length === 0)) {
    return undefined;
  }
  const { refreshed, failed } = outcome;
  const noun = (n: number): string => `${n} ${n === 1 ? 'worksheet' : 'worksheets'}`;
  return `Desktop reported a ${outcome.outcome} refresh of auto-updates for ${scope}: ${noun(refreshed.length)} refreshed, ${failed.length} failed`;
}
