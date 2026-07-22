import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';

export const mockFlowRunTasks = [
  {
    id: '1bff10bb-57ae-43df-8774-a86d14aef432',
    priority: 50,
    consecutiveFailedCount: 2,
    type: 'RunFlowTask',
    schedule: {
      id: '36d6fab2-2a0a-432e-b464-9fe4229a9937',
      name: 'Every 2 Minutes',
      state: 'Active',
      priority: 50,
      createdAt: '2018-11-08T21:57:49Z',
      updatedAt: '2018-11-09T17:30:08Z',
      type: 'Flow',
      frequency: 'Hourly',
      nextRunAt: '2018-11-09T17:32:00Z',
    },
    flow: {
      id: '8a320dca-9151-41ea-8474-a0bb71961cc0',
      name: 'allUseCaseTFLX2',
    },
  },
  {
    id: '357aaf2b-758d-4feb-a447-822528635a67',
    priority: 44,
    consecutiveFailedCount: 0,
    type: 'RunFlowTask',
    schedule: {
      id: '6d4e61d0-2e2f-4f48-abc8-0695b95a5287',
      name: 'Every 15 mins',
      state: 'Suspended',
      priority: 50,
      createdAt: '2018-11-08T20:45:47Z',
      updatedAt: '2018-11-09T17:30:08Z',
      type: 'Flow',
      frequency: 'Daily',
      nextRunAt: '2018-11-09T17:45:00Z',
    },
    flow: {
      id: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
      name: 'SQLServerUserNamePassword Good',
    },
  },
] satisfies Array<FlowRunTask>;
