import {
  Flow,
  FlowConnection,
  FlowOutputStep,
  FlowRun,
} from '../../../../sdks/tableau/types/flow.js';

export const mockFlow = {
  id: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
  name: 'Sales Cleanup',
  description: 'Cleans up the daily sales feed',
  webpageUrl: 'http://tpqawin01/#/flows/3',
  fileType: 'tflx',
  createdAt: '2024-11-06T04:57:55Z',
  updatedAt: '2024-11-06T21:31:00Z',
  project: { id: '6f8a2966-e173-11e8-ae74-ffd84c19d7f3', name: 'Default' },
  owner: { id: '711e59cf-d1c0-446e-be48-3673ae067f7b' },
  tags: { tag: [{ label: 'sales' }] },
} satisfies Flow;

export const mockOutputSteps = [
  { id: '5e4c9a74-d29a-4f62-baa5-97c443440dfc', name: 'CoffeeChainOutputCSV' },
  { id: 'baa85bce-6aab-434a-8070-72625ded8cb6', name: 'CoffeeChainOutputHyper' },
] satisfies Array<FlowOutputStep>;

export const mockConnections = [
  {
    id: '5fd1c1db-572f-4ebd-94e7-a09e212bc147',
    type: 'sqlserver',
    serverAddress: 'mySQLServer',
    userName: 'analyst',
    embedPassword: true,
  },
] satisfies Array<FlowConnection>;

export const mockFlowRuns = [
  {
    id: 'a1a1a1a1-1111-1111-1111-111111111111',
    flowId: mockFlow.id,
    status: 'Success',
    startedAt: '2025-04-01T10:00:00Z',
    completedAt: '2025-04-01T10:05:00Z',
    progress: 100,
    backgroundJobId: 'b1b1b1b1-1111-1111-1111-111111111111',
  },
  {
    id: 'a2a2a2a2-2222-2222-2222-222222222222',
    flowId: mockFlow.id,
    status: 'Failed',
    startedAt: '2025-03-31T10:00:00Z',
    completedAt: '2025-03-31T10:02:00Z',
    progress: 50,
    backgroundJobId: 'b2b2b2b2-2222-2222-2222-222222222222',
  },
] satisfies Array<FlowRun>;
