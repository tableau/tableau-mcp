import { describe, expect, it } from 'vitest';

import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import {
  aggregateSchedulesFromTasks,
  applySchedulesFilters,
  exportedForTesting,
  parseAndValidateSchedulesFilterString,
} from './schedulesUtils.js';

const { getScheduleKey } = exportedForTesting;

function task(overrides: Partial<ExtractRefreshTask>): ExtractRefreshTask {
  return { id: 'task', ...overrides };
}

describe('aggregateSchedulesFromTasks', () => {
  it('groups tasks sharing the same schedule id and counts them', () => {
    const tasks = [
      task({ id: 't1', datasource: { id: 'ds1' }, schedule: { id: 's1', frequency: 'Daily' } }),
      task({ id: 't2', datasource: { id: 'ds2' }, schedule: { id: 's1', frequency: 'Daily' } }),
      task({ id: 't3', workbook: { id: 'wb1' }, schedule: { id: 's1', frequency: 'Daily' } }),
    ];

    const schedules = aggregateSchedulesFromTasks(tasks);

    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe('s1');
    expect(schedules[0].taskCount).toBe(3);
    expect(schedules[0].datasourceIds?.sort()).toEqual(['ds1', 'ds2']);
    expect(schedules[0].workbookIds).toEqual(['wb1']);
  });

  it('separates distinct schedules', () => {
    const tasks = [
      task({ id: 't1', schedule: { id: 's1', frequency: 'Daily' } }),
      task({ id: 't2', schedule: { id: 's2', frequency: 'Weekly' } }),
    ];

    const schedules = aggregateSchedulesFromTasks(tasks);

    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('falls back to a composite key when schedule id is absent', () => {
    const tasks = [
      task({ id: 't1', schedule: { name: 'Nightly', frequency: 'Daily', nextRunAt: 'X' } }),
      task({ id: 't2', schedule: { name: 'Nightly', frequency: 'Daily', nextRunAt: 'X' } }),
    ];

    const schedules = aggregateSchedulesFromTasks(tasks);

    expect(schedules).toHaveLength(1);
    expect(schedules[0].taskCount).toBe(2);
    expect(schedules[0].name).toBe('Nightly');
  });

  it('skips tasks with no identifiable schedule', () => {
    const tasks = [task({ id: 't1' }), task({ id: 't2', schedule: {} })];
    expect(aggregateSchedulesFromTasks(tasks)).toEqual([]);
  });

  it('omits empty id arrays', () => {
    const schedules = aggregateSchedulesFromTasks([task({ id: 't1', schedule: { id: 's1' } })]);
    expect(schedules[0].datasourceIds).toBeUndefined();
    expect(schedules[0].workbookIds).toBeUndefined();
  });
});

describe('getScheduleKey', () => {
  it('prefers the schedule id', () => {
    expect(getScheduleKey(task({ schedule: { id: 's1', name: 'n' } }))).toBe('id:s1');
  });

  it('returns undefined when no schedule', () => {
    expect(getScheduleKey(task({}))).toBeUndefined();
  });
});

describe('parseAndValidateSchedulesFilterString', () => {
  it('accepts valid field/operator pairs', () => {
    expect(parseAndValidateSchedulesFilterString('frequency:eq:Daily')).toBe('frequency:eq:Daily');
    expect(parseAndValidateSchedulesFilterString('taskCount:gt:1')).toBe('taskCount:gt:1');
  });

  it('rejects an unknown field', () => {
    expect(() => parseAndValidateSchedulesFilterString('bogus:eq:x')).toThrow();
  });

  it('rejects a disallowed operator for a field', () => {
    expect(() => parseAndValidateSchedulesFilterString('frequency:gt:Daily')).toThrow();
  });
});

describe('applySchedulesFilters', () => {
  const schedules = [
    { taskCount: 3, frequency: 'Daily', state: 'Active', priority: 10 },
    { taskCount: 1, frequency: 'Weekly', state: 'Suspended', priority: 5 },
  ];

  it('returns all schedules when no filter', () => {
    expect(applySchedulesFilters(schedules, undefined)).toHaveLength(2);
  });

  it('filters by eq', () => {
    const result = applySchedulesFilters(schedules, 'frequency:eq:Daily');
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe('Daily');
  });

  it('filters by numeric gt', () => {
    const result = applySchedulesFilters(schedules, 'taskCount:gt:1');
    expect(result).toHaveLength(1);
    expect(result[0].taskCount).toBe(3);
  });

  it('filters by in', () => {
    const result = applySchedulesFilters(schedules, 'frequency:in:Daily|Weekly');
    expect(result).toHaveLength(2);
  });

  it('ANDs multiple filters', () => {
    const result = applySchedulesFilters(schedules, 'frequency:eq:Daily,priority:gte:10');
    expect(result).toHaveLength(1);
  });
});
