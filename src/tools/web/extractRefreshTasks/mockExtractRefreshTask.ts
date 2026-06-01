import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';

export const mockExtractRefreshTask: ExtractRefreshTask = {
  id: 'task-123',
  priority: 50,
  consecutiveFailedCount: 0,
  type: 'RefreshExtractTask',
  datasource: { id: 'datasource-abc' },
  schedule: {
    id: 'schedule-xyz',
    name: 'Hourly Extract Refresh',
    state: 'Active',
    priority: 50,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-20T12:00:00Z',
    type: 'Extract',
    frequency: 'Hourly',
    nextRunAt: '2026-05-20T17:00:00Z',
    frequencyDetails: {
      start: '08:00:00',
      end: '18:00:00',
      intervals: {
        interval: [
          {
            hours: 8,
            minutes: 0,
          },
        ],
      },
    },
  },
};
