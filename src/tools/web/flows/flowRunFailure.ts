import { FlowRun } from '../../../sdks/tableau/types/flow.js';

/**
 * One distinct failure cause within a window of flow runs, with how many runs and
 * which flows it affected. `available: false` means Tableau could not determine
 * the cause and `message` is a generic placeholder.
 */
export type FlowRunFailureReasonGroup = {
  message: string;
  available: boolean;
  // Number of `Failed` runs in the window that reported this exact reason.
  runCount: number;
  // DISTINCT flows affected by this reason, ascending. The blast radius of one cause.
  flowIds: string[];
};

/**
 * Failures for a window of flow runs, grouped by reported message so a caller can
 * tell one systemic problem from many unrelated ones without reading every record.
 *
 * `failedRunCount` / `failedFlowCount` describe ALL `Failed` runs in the window,
 * including any that carry no `failureReason` — deliberately the same definition
 * `buildFailureInsight` uses, so the two fields never disagree about one window.
 * Consequently `sum(reasons[].runCount) <= failedRunCount`.
 */
export type FlowRunFailureSummary = {
  failedRunCount: number;
  failedFlowCount: number;
  reasons: FlowRunFailureReasonGroup[];
};

// Joins the two group-key fields. A character that cannot appear in a message, so
// the key stays unambiguous even if the prefix is ever widened beyond the two
// boolean spellings (which alone could not collide).
const GROUP_KEY_SEPARATOR = '\u0000';

/**
 * The window's failed runs. Shared with `buildFailureInsight` so `failedRunCount`
 * and `failedFlowCount` have ONE definition and the two fields can never disagree
 * about the same window.
 */
export function getFailedRuns(flowRuns: FlowRun[]): FlowRun[] {
  return flowRuns.filter((run) => run.status === 'Failed');
}

/** Distinct flows among the given runs, skipping any run with no `flowId`. */
export function countDistinctFlows(runs: FlowRun[]): number {
  return new Set(runs.map((run) => run.flowId).filter((id): id is string => id !== undefined)).size;
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Group the window's failure reasons by reported message.
 *
 * A group is a symptom, not necessarily a root cause: Tableau resolves the message
 * from a localization key, and distinct underlying errors can share one key's short
 * message (a flow-execution failure and an authentication failure both render as
 * "Flow processing error"). The key itself is not exposed by the REST API, so the
 * message is the finest grain available to group on.
 *
 * Returns `undefined` when no `Failed` run carries a `failureReason` — either the
 * window has no failures at all, or the server predates REST API 3.30. Both cases
 * leave the caller on its existing no-reason path.
 */
export function summarizeFlowRunFailures(flowRuns: FlowRun[]): FlowRunFailureSummary | undefined {
  const failedRuns = getFailedRuns(flowRuns);

  // Keyed on the (message, available) PAIR rather than the message alone: two
  // runs could in principle share a message while disagreeing on availability,
  // and keying on the pair keeps each group's `available` well-defined by
  // construction instead of depending on which run was seen first.
  const groups = new Map<
    string,
    { message: string; available: boolean; runCount: number; flowIds: Set<string> }
  >();

  for (const run of failedRuns) {
    const reason = run.failureReason;
    if (!reason) {
      continue;
    }

    const key = `${String(reason.available)}${GROUP_KEY_SEPARATOR}${reason.message}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        message: reason.message,
        available: reason.available,
        runCount: 0,
        flowIds: new Set<string>(),
      };
      groups.set(key, group);
    }

    group.runCount += 1;
    if (run.flowId !== undefined) {
      group.flowIds.add(run.flowId);
    }
  }

  if (groups.size === 0) {
    return undefined;
  }

  const reasons = [...groups.values()]
    .map((group) => ({
      message: group.message,
      available: group.available,
      runCount: group.runCount,
      flowIds: [...group.flowIds].sort(),
    }))
    // Biggest cause first. `message` then `available` complete a total order —
    // without the third key, two groups sharing a count and a message would fall
    // back to insertion order and could differ between callers. Message ordering
    // compares codepoints rather than using localeCompare, which can return 0 for
    // distinct strings (e.g. precomposed vs. combining accents) and so would leave
    // the order incomplete for exactly the case the third key exists to fix.
    .sort(
      (a, b) =>
        b.runCount - a.runCount ||
        compareStrings(a.message, b.message) ||
        Number(b.available) - Number(a.available),
    );

  return {
    failedRunCount: failedRuns.length,
    failedFlowCount: countDistinctFlows(failedRuns),
    reasons,
  };
}

/**
 * Whether the caller still needs the Tableau UI deep link to explain a failure.
 *
 * True when the window holds a `Failed` run but nothing in it carries a resolved
 * cause. Note that reasons with `available: false` do NOT satisfy the caller: the
 * placeholder message is not a diagnosis, so those windows still need the link.
 */
export function needsUiFallback(flowRuns: FlowRun[]): boolean {
  const failedRuns = getFailedRuns(flowRuns);
  if (failedRuns.length === 0) {
    return false;
  }
  return !failedRuns.some((run) => run.failureReason?.available === true);
}

/**
 * A flow's run-history page, which lists its runs and lets the user expand a
 * failed one to read the error. `webpageUrl` is the flow's UI page in numeric-id
 * form (e.g. .../#/site/<site>/flows/<id>); its run-history tab is that page plus
 * "/runHistory" (matching what the Tableau UI links to).
 */
export function buildRunHistoryUrl(webpageUrl: string): string {
  return `${webpageUrl.replace(/\/+$/, '')}/runHistory`;
}
