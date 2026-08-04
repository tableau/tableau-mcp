import { FlowRun } from '../../../sdks/tableau/types/flow.js';
import { buildRunHistoryUrl, needsUiFallback, summarizeFlowRunFailures } from './flowRunFailure.js';
import {
  mockFlowRunFlowIds,
  mockFlowRuns,
  mockFlowRunsUnresolvedFailure,
  mockFlowRunsWithFailureReasons,
} from './listFlowRuns/mockFlowRuns.js';

const { FLOW_A, FLOW_B, FLOW_C } = mockFlowRunFlowIds;

function failedRun(overrides: Partial<FlowRun> & { id: string }): FlowRun {
  return { status: 'Failed', ...overrides };
}

describe('summarizeFlowRunFailures', () => {
  it('returns undefined when there are no runs at all', () => {
    expect(summarizeFlowRunFailures([])).toBeUndefined();
  });

  it('returns undefined when no run failed', () => {
    const runs = mockFlowRuns.filter((run) => run.status !== 'Failed');
    expect(summarizeFlowRunFailures(runs)).toBeUndefined();
  });

  // A pre-3.30 server: failures exist but carry no reason, so the caller stays on
  // its existing no-reason path.
  it('returns undefined when failed runs carry no failureReason', () => {
    expect(summarizeFlowRunFailures(mockFlowRuns)).toBeUndefined();
  });

  it('groups reasons by message, biggest first', () => {
    const summary = summarizeFlowRunFailures(mockFlowRunsWithFailureReasons);

    expect(summary).toEqual({
      failedRunCount: 6,
      failedFlowCount: 3,
      reasons: [
        {
          // Ascending, so FLOW_B ("c1e8...") precedes FLOW_A ("d007...").
          message: 'Table "orders" was not found.',
          available: true,
          runCount: 3,
          flowIds: [FLOW_B, FLOW_A],
        },
        {
          message: 'Connection to mySQLServer timed out.',
          available: true,
          runCount: 1,
          flowIds: [FLOW_C],
        },
        {
          message: 'Error in flow steps',
          available: false,
          runCount: 1,
          flowIds: [FLOW_C],
        },
      ],
    });
  });

  it('de-duplicates flowIds so a flow failing repeatedly for one cause appears once', () => {
    const summary = summarizeFlowRunFailures(mockFlowRunsWithFailureReasons);
    const topReason = summary!.reasons[0];

    // FLOW_A failed twice for this cause; FLOW_B once.
    expect(topReason.runCount).toBe(3);
    expect(topReason.flowIds).toEqual([FLOW_B, FLOW_A]);
  });

  it('counts every failed run in the window, not only reason-bearing ones', () => {
    const summary = summarizeFlowRunFailures(mockFlowRunsWithFailureReasons)!;
    const groupedRunCount = summary.reasons.reduce((sum, reason) => sum + reason.runCount, 0);

    // The invariant callers rely on. Strictly less here, because one failed run
    // carries no reason — it counts toward the total but joins no group.
    expect(groupedRunCount).toBeLessThan(summary.failedRunCount);
    expect(summary.failedRunCount).toBe(6);
    expect(groupedRunCount).toBe(5);
  });

  it('matches the grouped count exactly when every failed run carries a reason', () => {
    const runs = mockFlowRunsWithFailureReasons.filter(
      (run) => run.status !== 'Failed' || run.failureReason !== undefined,
    );

    const summary = summarizeFlowRunFailures(runs)!;
    const groupedRunCount = summary.reasons.reduce((sum, reason) => sum + reason.runCount, 0);

    expect(groupedRunCount).toBe(summary.failedRunCount);
  });

  it('ignores runs that did not fail', () => {
    const summary = summarizeFlowRunFailures([
      ...mockFlowRunsWithFailureReasons,
      {
        id: 'aaaaaaaa-0000-0000-0000-000000000000',
        flowId: 'f0f0f0f0-0000-0000-0000-000000000000',
        status: 'Success',
        // A non-Failed run should never contribute, even if it somehow carries one.
        failureReason: { available: true, message: 'Should be ignored.' },
      },
    ])!;

    expect(summary.failedRunCount).toBe(6);
    expect(summary.reasons.map((reason) => reason.message)).not.toContain('Should be ignored.');
  });

  it('keys groups on the (message, available) pair so availability stays well-defined', () => {
    const summary = summarizeFlowRunFailures([
      failedRun({ id: 'r1', flowId: FLOW_A, failureReason: { available: true, message: 'Same' } }),
      failedRun({ id: 'r2', flowId: FLOW_B, failureReason: { available: false, message: 'Same' } }),
    ])!;

    expect(summary.reasons).toHaveLength(2);
    expect(summary.reasons.map((reason) => reason.available)).toEqual([true, false]);
  });

  // Without the third sort key these two groups tie on both count and message and
  // would fall back to input order, so the two tools could disagree.
  it('breaks a count-and-message tie on availability, resolved first', () => {
    // Same flow throughout, so the two groups differ ONLY in `available` and the
    // comparison below isolates ordering.
    const unresolvedFirst = summarizeFlowRunFailures([
      failedRun({ id: 'r1', flowId: FLOW_A, failureReason: { available: false, message: 'Same' } }),
      failedRun({ id: 'r2', flowId: FLOW_A, failureReason: { available: true, message: 'Same' } }),
    ])!;
    const resolvedFirst = summarizeFlowRunFailures([
      failedRun({ id: 'r1', flowId: FLOW_A, failureReason: { available: true, message: 'Same' } }),
      failedRun({ id: 'r2', flowId: FLOW_A, failureReason: { available: false, message: 'Same' } }),
    ])!;

    expect(unresolvedFirst.reasons.map((reason) => reason.available)).toEqual([true, false]);
    // Input order must not leak into the output, or the two tools could disagree.
    expect(resolvedFirst.reasons).toEqual(unresolvedFirst.reasons);
  });

  it('treats an empty message as reason-bearing', () => {
    const summary = summarizeFlowRunFailures([
      failedRun({ id: 'r1', flowId: FLOW_A, failureReason: { available: true, message: '' } }),
    ])!;

    expect(summary.reasons).toEqual([
      { message: '', available: true, runCount: 1, flowIds: [FLOW_A] },
    ]);
  });

  it('omits a missing flowId from the blast radius without dropping the run', () => {
    const summary = summarizeFlowRunFailures([
      failedRun({ id: 'r1', failureReason: { available: true, message: 'No flow id' } }),
    ])!;

    expect(summary.failedRunCount).toBe(1);
    expect(summary.failedFlowCount).toBe(0);
    expect(summary.reasons[0]).toEqual({
      message: 'No flow id',
      available: true,
      runCount: 1,
      flowIds: [],
    });
  });
});

describe('needsUiFallback', () => {
  it('is false when nothing failed', () => {
    expect(needsUiFallback([])).toBe(false);
    expect(needsUiFallback(mockFlowRuns.filter((run) => run.status !== 'Failed'))).toBe(false);
  });

  it('is true when a failure carries no reason at all', () => {
    expect(needsUiFallback(mockFlowRuns)).toBe(true);
  });

  // The case a naive "skip the fallback whenever reasons exist" gets wrong: the
  // placeholder message is not a diagnosis, so the deep link is still needed.
  it('is true when every reason in the window is unresolved', () => {
    expect(needsUiFallback(mockFlowRunsUnresolvedFailure)).toBe(true);
  });

  it('is false as soon as one failure has a resolved reason', () => {
    expect(needsUiFallback(mockFlowRunsWithFailureReasons)).toBe(false);
  });

  it('is false when a resolved reason sits alongside unresolved and reason-less failures', () => {
    expect(
      needsUiFallback([
        ...mockFlowRunsUnresolvedFailure,
        failedRun({ id: 'r1', flowId: FLOW_B }),
        failedRun({
          id: 'r2',
          flowId: FLOW_A,
          failureReason: { available: true, message: 'Resolved' },
        }),
      ]),
    ).toBe(false);
  });
});

describe('buildRunHistoryUrl', () => {
  it('appends the run-history tab', () => {
    expect(buildRunHistoryUrl('http://tpqawin01/#/flows/3')).toBe(
      'http://tpqawin01/#/flows/3/runHistory',
    );
  });

  it.each([
    ['one trailing slash', 'http://host/#/flows/3/'],
    ['several', 'http://host/#/flows/3///'],
  ])('strips %s before appending', (_label, webpageUrl) => {
    expect(buildRunHistoryUrl(webpageUrl)).toBe('http://host/#/flows/3/runHistory');
  });
});
