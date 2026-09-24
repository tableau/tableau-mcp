import { FlowRun } from '../../../../sdks/tableau/types/flow.js';

const FLOW_A = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';
const FLOW_B = 'c1e82fe3-e7cf-4bd5-afd3-799b1e8aac27';
const FLOW_C = 'e2f93ba4-9c17-4bd5-afd3-799b1e8aac99';

/**
 * Baseline runs, deliberately WITHOUT any `failureReason` — the shape a pre-3.30
 * server returns. Existing tests assert the no-reason behavior against this, which
 * is the AC3 regression baseline, so do not add reasons here.
 */
export const mockFlowRuns = [
  {
    id: 'a1111111-1111-1111-1111-111111111111',
    flowId: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
    status: 'Success',
    startedAt: '2025-01-03T10:00:00Z',
    completedAt: '2025-01-03T10:05:00Z',
    progress: 100,
    backgroundJobId: 'job-1111',
  },
  {
    id: 'b2222222-2222-2222-2222-222222222222',
    flowId: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
    status: 'Failed',
    startedAt: '2025-01-02T10:00:00Z',
    completedAt: '2025-01-02T10:01:00Z',
    progress: 100,
    backgroundJobId: 'job-2222',
  },
  {
    id: 'c3333333-3333-3333-3333-333333333333',
    flowId: 'c1e82fe3-e7cf-4bd5-afd3-799b1e8aac27',
    status: 'InProgress',
    startedAt: '2025-01-01T10:00:00Z',
    progress: 42,
    backgroundJobId: 'job-3333',
  },
] satisfies Array<FlowRun>;

/**
 * A REST 3.30+ window exercising every grouping case at once: one cause repeated
 * across two flows (three runs), a second resolved cause, an unresolved
 * (`available: false`) cause, and a `Failed` run carrying no reason at all.
 *
 * Expected summary: `failedRunCount` 6, `failedFlowCount` 3, and three reason
 * groups summing to 5 runs — deliberately less than 6, since the reason-less run
 * counts toward the total but joins no group.
 */
export const mockFlowRunsWithFailureReasons = [
  {
    id: 'f1111111-1111-1111-1111-111111111111',
    flowId: FLOW_A,
    status: 'Failed',
    startedAt: '2025-06-05T10:00:00Z',
    completedAt: '2025-06-05T10:01:00Z',
    progress: 100,
    failureReason: { available: true, message: 'Table "orders" was not found.' },
  },
  {
    id: 'f2222222-2222-2222-2222-222222222222',
    flowId: FLOW_B,
    status: 'Failed',
    startedAt: '2025-06-04T10:00:00Z',
    completedAt: '2025-06-04T10:01:00Z',
    progress: 100,
    failureReason: { available: true, message: 'Table "orders" was not found.' },
  },
  {
    id: 'f3333333-3333-3333-3333-333333333333',
    flowId: FLOW_A,
    status: 'Failed',
    startedAt: '2025-06-03T10:00:00Z',
    completedAt: '2025-06-03T10:01:00Z',
    progress: 100,
    failureReason: { available: true, message: 'Table "orders" was not found.' },
  },
  {
    id: 'f4444444-4444-4444-4444-444444444444',
    flowId: FLOW_C,
    status: 'Failed',
    startedAt: '2025-06-02T10:00:00Z',
    completedAt: '2025-06-02T10:01:00Z',
    progress: 100,
    failureReason: { available: true, message: 'Connection to mySQLServer timed out.' },
  },
  {
    id: 'f5555555-5555-5555-5555-555555555555',
    flowId: FLOW_C,
    status: 'Failed',
    startedAt: '2025-06-01T10:00:00Z',
    completedAt: '2025-06-01T10:01:00Z',
    progress: 100,
    failureReason: { available: false, message: 'Error in flow steps' },
  },
  {
    id: 'f6666666-6666-6666-6666-666666666666',
    flowId: FLOW_B,
    status: 'Failed',
    startedAt: '2025-05-31T10:00:00Z',
    completedAt: '2025-05-31T10:01:00Z',
    progress: 100,
  },
  {
    id: 'f7777777-7777-7777-7777-777777777777',
    flowId: FLOW_A,
    status: 'Success',
    startedAt: '2025-05-30T10:00:00Z',
    completedAt: '2025-05-30T10:05:00Z',
    progress: 100,
  },
] satisfies Array<FlowRun>;

/**
 * A window whose only failure reason is unresolved. The tool must still fall back
 * to the UI deep link here: the placeholder message is not a diagnosis.
 */
export const mockFlowRunsUnresolvedFailure = [
  {
    id: 'f8888888-8888-8888-8888-888888888888',
    flowId: FLOW_A,
    status: 'Failed',
    startedAt: '2025-06-06T10:00:00Z',
    completedAt: '2025-06-06T10:01:00Z',
    progress: 100,
    failureReason: { available: false, message: 'Error in flow steps' },
  },
] satisfies Array<FlowRun>;

export const mockFlowRunFlowIds = { FLOW_A, FLOW_B, FLOW_C };
