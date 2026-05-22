import { describe, expect, it } from 'vitest';

import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import {
  applyTaskFilters,
  exportedForTesting,
  parseAndValidateExtractRefreshTasksFilterString,
} from './extractRefreshTasksFilterUtils.js';

const { getFieldValue, matchesFilter } = exportedForTesting;

const mockTask: ExtractRefreshTask = {
  id: 'task-123',
  type: 'RefreshExtractTask',
  priority: 5,
  consecutiveFailedCount: 0,
  datasource: { id: 'ds-456' },
  schedule: {
    id: 'sched-789',
    name: 'Daily Refresh',
    state: 'Active',
    frequency: 'Daily',
    nextRunAt: '2026-05-23T08:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  },
};

describe('extractRefreshTasksFilterUtils', () => {
  describe('parseAndValidateExtractRefreshTasksFilterString', () => {
    it('should parse valid filter string', () => {
      const result = parseAndValidateExtractRefreshTasksFilterString('id:eq:task-123');
      expect(result).toBe('id:eq:task-123');
    });

    it('should parse multiple filters', () => {
      const result = parseAndValidateExtractRefreshTasksFilterString(
        'priority:gte:5,schedule.frequency:eq:Daily',
      );
      expect(result).toBe('priority:gte:5,schedule.frequency:eq:Daily');
    });

    it('should throw on invalid field', () => {
      expect(() =>
        parseAndValidateExtractRefreshTasksFilterString('invalidField:eq:value'),
      ).toThrow();
    });

    it('should throw on invalid operator for field', () => {
      expect(() => parseAndValidateExtractRefreshTasksFilterString('id:gt:123')).toThrow();
    });
  });

  describe('getFieldValue', () => {
    it('should get top-level fields', () => {
      expect(getFieldValue(mockTask, 'id')).toBe('task-123');
      expect(getFieldValue(mockTask, 'priority')).toBe(5);
      expect(getFieldValue(mockTask, 'consecutiveFailedCount')).toBe(0);
    });

    it('should get nested datasource field', () => {
      expect(getFieldValue(mockTask, 'datasource.id')).toBe('ds-456');
    });

    it('should get nested schedule fields', () => {
      expect(getFieldValue(mockTask, 'schedule.name')).toBe('Daily Refresh');
      expect(getFieldValue(mockTask, 'schedule.frequency')).toBe('Daily');
      expect(getFieldValue(mockTask, 'schedule.state')).toBe('Active');
    });

    it('should return undefined for missing optional fields', () => {
      const taskWithoutSchedule: ExtractRefreshTask = { ...mockTask, schedule: undefined };
      expect(getFieldValue(taskWithoutSchedule, 'schedule.name')).toBeUndefined();
    });
  });

  describe('matchesFilter', () => {
    describe('eq operator', () => {
      it('should match equal strings', () => {
        expect(matchesFilter('Daily', 'eq', 'Daily')).toBe(true);
      });

      it('should not match different strings', () => {
        expect(matchesFilter('Daily', 'eq', 'Weekly')).toBe(false);
      });

      it('should match equal numbers as strings', () => {
        expect(matchesFilter(5, 'eq', '5')).toBe(true);
      });
    });

    describe('in operator', () => {
      it('should match value in pipe-separated list', () => {
        expect(matchesFilter('Daily', 'in', 'Daily|Weekly|Monthly')).toBe(true);
      });

      it('should not match value not in list', () => {
        expect(matchesFilter('Hourly', 'in', 'Daily|Weekly|Monthly')).toBe(false);
      });
    });

    describe('comparison operators', () => {
      it('should compare numbers with gt', () => {
        expect(matchesFilter(10, 'gt', '5')).toBe(true);
        expect(matchesFilter(5, 'gt', '5')).toBe(false);
      });

      it('should compare numbers with gte', () => {
        expect(matchesFilter(5, 'gte', '5')).toBe(true);
        expect(matchesFilter(4, 'gte', '5')).toBe(false);
      });

      it('should compare numbers with lt', () => {
        expect(matchesFilter(3, 'lt', '5')).toBe(true);
        expect(matchesFilter(5, 'lt', '5')).toBe(false);
      });

      it('should compare numbers with lte', () => {
        expect(matchesFilter(5, 'lte', '5')).toBe(true);
        expect(matchesFilter(6, 'lte', '5')).toBe(false);
      });

      it('should compare strings lexicographically', () => {
        expect(matchesFilter('2026-05-20', 'lt', '2026-05-25')).toBe(true);
        expect(matchesFilter('2026-05-30', 'lt', '2026-05-25')).toBe(false);
      });
    });

    it('should return false for undefined/null values', () => {
      expect(matchesFilter(undefined, 'eq', 'value')).toBe(false);
      expect(matchesFilter(null, 'eq', 'value')).toBe(false);
    });
  });

  describe('applyTaskFilters', () => {
    const tasks: ExtractRefreshTask[] = [
      mockTask,
      {
        id: 'task-456',
        priority: 10,
        consecutiveFailedCount: 2,
        workbook: { id: 'wb-789' },
        schedule: {
          frequency: 'Weekly',
          nextRunAt: '2026-05-24T08:00:00Z',
        },
      },
      {
        id: 'task-789',
        priority: 1,
        consecutiveFailedCount: 0,
        datasource: { id: 'ds-999' },
        schedule: {
          frequency: 'Daily',
          nextRunAt: '2026-05-25T08:00:00Z',
        },
      },
    ];

    it('should return all tasks when no filter provided', () => {
      const result = applyTaskFilters(tasks, undefined);
      expect(result).toEqual(tasks);
    });

    it('should filter by single field with eq', () => {
      const result = applyTaskFilters(tasks, 'schedule.frequency:eq:Daily');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('task-123');
      expect(result[1].id).toBe('task-789');
    });

    it('should filter by priority with gte', () => {
      const result = applyTaskFilters(tasks, 'priority:gte:5');
      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe(5);
      expect(result[1].priority).toBe(10);
    });

    it('should filter by multiple conditions (AND)', () => {
      const result = applyTaskFilters(tasks, 'schedule.frequency:eq:Daily,priority:gte:5');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task-123');
    });

    it('should filter by in operator', () => {
      const result = applyTaskFilters(tasks, 'id:in:task-123|task-456');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('task-123');
      expect(result[1].id).toBe('task-456');
    });

    it('should return empty array when no tasks match', () => {
      const result = applyTaskFilters(tasks, 'priority:gt:100');
      expect(result).toHaveLength(0);
    });

    it('should filter by datasource id', () => {
      const result = applyTaskFilters(tasks, 'datasource.id:eq:ds-456');
      expect(result).toHaveLength(1);
      expect(result[0].datasource?.id).toBe('ds-456');
    });

    it('should filter by workbook id', () => {
      const result = applyTaskFilters(tasks, 'workbook.id:eq:wb-789');
      expect(result).toHaveLength(1);
      expect(result[0].workbook?.id).toBe('wb-789');
    });

    it('should handle date comparison in nextRunAt', () => {
      const result = applyTaskFilters(tasks, 'schedule.nextRunAt:lt:2026-05-24T00:00:00Z');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task-123');
    });
  });
});
