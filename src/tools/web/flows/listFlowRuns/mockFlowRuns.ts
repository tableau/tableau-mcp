import { FlowRun } from '../../../../sdks/tableau/types/flow.js';

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
