import { z } from 'zod';

import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { Schedule } from '../../../sdks/tableau/types/schedule.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

// === Schedule aggregation ===

/**
 * Build a stable identity key for a task's schedule so that tasks sharing the
 * same schedule are grouped together. Tableau Cloud does not always populate
 * `schedule.id`, so we fall back to a composite of the human-meaningful fields.
 */
function getScheduleKey(task: ExtractRefreshTask): string | undefined {
  const schedule = task.schedule;
  if (!schedule) {
    return undefined;
  }
  if (schedule.id) {
    return `id:${schedule.id}`;
  }
  const composite = [schedule.name, schedule.frequency, schedule.nextRunAt]
    .filter((v) => v !== undefined && v !== '')
    .join('|');
  return composite ? `composite:${composite}` : undefined;
}

/**
 * Aggregate the distinct schedules referenced by a site's extract refresh tasks.
 *
 * Each returned schedule carries the underlying schedule fields plus aggregation
 * metadata: how many tasks run on it (`taskCount`) and which data sources and
 * workbooks those tasks target.
 *
 * Tasks whose schedule cannot be identified (no `schedule` object and no usable
 * fields) are skipped - they contribute no schedule to enumerate.
 */
export function aggregateSchedulesFromTasks(tasks: ExtractRefreshTask[]): Schedule[] {
  const byKey = new Map<
    string,
    { schedule: Schedule; datasourceIds: Set<string>; workbookIds: Set<string> }
  >();

  for (const task of tasks) {
    const key = getScheduleKey(task);
    if (!key || !task.schedule) {
      continue;
    }

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        schedule: { ...task.schedule, taskCount: 0 },
        datasourceIds: new Set<string>(),
        workbookIds: new Set<string>(),
      };
      byKey.set(key, entry);
    }

    entry.schedule.taskCount += 1;
    if (task.datasource?.id) {
      entry.datasourceIds.add(task.datasource.id);
    }
    if (task.workbook?.id) {
      entry.workbookIds.add(task.workbook.id);
    }
  }

  return Array.from(byKey.values()).map(({ schedule, datasourceIds, workbookIds }) => ({
    ...schedule,
    ...(datasourceIds.size > 0 ? { datasourceIds: Array.from(datasourceIds) } : {}),
    ...(workbookIds.size > 0 ? { workbookIds: Array.from(workbookIds) } : {}),
  }));
}

// === Field and Operator Definitions ===
// Client-side filtering for schedules (derived data, no server-side filter support)

const FilterFieldSchema = z.enum([
  'id',
  'name',
  'type',
  'state',
  'frequency',
  'priority',
  'taskCount',
  'nextRunAt',
  'createdAt',
  'updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  id: ['eq', 'in'],
  name: ['eq', 'in'],
  type: ['eq', 'in'],
  state: ['eq', 'in'],
  frequency: ['eq', 'in'],
  priority: ['eq', 'gt', 'gte', 'lt', 'lte'],
  taskCount: ['eq', 'gt', 'gte', 'lt', 'lte'],
  nextRunAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateSchedulesFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Apply client-side filtering to aggregated schedules based on filter expressions.
 * Supports field:operator:value syntax (e.g., "frequency:eq:Daily").
 */
export function applySchedulesFilters(
  schedules: Schedule[],
  filterString: string | undefined,
): Schedule[] {
  if (!filterString) {
    return schedules;
  }

  const validatedFilter = parseAndValidateSchedulesFilterString(filterString);
  const filters = validatedFilter.split(',').map((f) => {
    const [field, operator, ...valueParts] = f.split(':');
    return {
      field: field as FilterField,
      operator: operator as FilterOperator,
      value: valueParts.join(':'),
    };
  });

  return schedules.filter((schedule) => {
    return filters.every(({ field, operator, value }) => {
      const fieldValue = getFieldValue(schedule, field);
      return matchesFilter(fieldValue, operator, value);
    });
  });
}

function getFieldValue(schedule: Schedule, field: FilterField): string | number | undefined {
  switch (field) {
    case 'id':
      return schedule.id;
    case 'name':
      return schedule.name;
    case 'type':
      return schedule.type;
    case 'state':
      return schedule.state;
    case 'frequency':
      return schedule.frequency;
    case 'priority':
      return schedule.priority;
    case 'taskCount':
      return schedule.taskCount;
    case 'nextRunAt':
      return schedule.nextRunAt;
    case 'createdAt':
      return schedule.createdAt;
    case 'updatedAt':
      return schedule.updatedAt;
    default:
      return undefined;
  }
}

function matchesFilter(
  fieldValue: string | number | undefined,
  operator: FilterOperator,
  filterValue: string,
): boolean {
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  const fieldStr = String(fieldValue);

  switch (operator) {
    case 'eq':
      return fieldStr === filterValue;
    case 'in':
      return filterValue.split('|').includes(fieldStr);
    case 'gt':
      return typeof fieldValue === 'number'
        ? fieldValue > Number(filterValue)
        : fieldStr > filterValue;
    case 'gte':
      return typeof fieldValue === 'number'
        ? fieldValue >= Number(filterValue)
        : fieldStr >= filterValue;
    case 'lt':
      return typeof fieldValue === 'number'
        ? fieldValue < Number(filterValue)
        : fieldStr < filterValue;
    case 'lte':
      return typeof fieldValue === 'number'
        ? fieldValue <= Number(filterValue)
        : fieldStr <= filterValue;
    default:
      return false;
  }
}

export const exportedForTesting = {
  FilterFieldSchema,
  getScheduleKey,
  getFieldValue,
  matchesFilter,
};
