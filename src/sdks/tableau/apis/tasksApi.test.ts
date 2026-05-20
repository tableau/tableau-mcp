import { describe, expect, it } from 'vitest';

import { parseListExtractRefreshTasksResponse } from './tasksApi.js';

describe('parseListExtractRefreshTasksResponse', () => {
  it('accepts Tableau empty tasks: {} by normalizing to task: []', () => {
    const data = parseListExtractRefreshTasksResponse({ tasks: {} });
    expect(data.tasks).toEqual({ task: [] });
  });

  it('does not change responses that already include task', () => {
    const entry = {
      extractRefresh: {
        id: 't1',
        datasource: { id: 'd1' },
      },
    };
    const data = parseListExtractRefreshTasksResponse({ tasks: { task: [entry] } });
    expect(data.tasks).toEqual({ task: [entry] });
  });

  it('coerces hours and minutes from strings to numbers in interval array', () => {
    const entry = {
      extractRefresh: {
        id: 't1',
        datasource: { id: 'd1' },
        schedule: {
          frequency: 'Hourly',
          frequencyDetails: {
            intervals: {
              interval: [{ hours: '08', minutes: '30' }],
            },
          },
        },
      },
    };
    const data = parseListExtractRefreshTasksResponse({ tasks: { task: [entry] } });
    expect(data.tasks).toEqual({
      task: [
        {
          extractRefresh: {
            id: 't1',
            datasource: { id: 'd1' },
            schedule: {
              frequency: 'Hourly',
              frequencyDetails: {
                intervals: {
                  interval: [{ hours: 8, minutes: 30 }],
                },
              },
            },
          },
        },
      ],
    });
  });
});
