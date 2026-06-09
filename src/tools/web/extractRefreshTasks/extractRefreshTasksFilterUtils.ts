import { z } from 'zod';

import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

// === Field and Operator Definitions ===
// Client-side filtering for extract refresh tasks (API doesn't support server-side filtering)

const FilterFieldSchema = z.enum([
  'id',
  'type',
  'priority',
  'consecutiveFailedCount',
  'datasource.id',
  'workbook.id',
  'schedule.id',
  'schedule.name',
  'schedule.state',
  'schedule.frequency',
  'schedule.nextRunAt',
  'schedule.createdAt',
  'schedule.updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  id: ['eq', 'in'],
  type: ['eq', 'in'],
  priority: ['eq', 'gt', 'gte', 'lt', 'lte'],
  consecutiveFailedCount: ['eq', 'gt', 'gte', 'lt', 'lte'],
  'datasource.id': ['eq', 'in'],
  'workbook.id': ['eq', 'in'],
  'schedule.id': ['eq', 'in'],
  'schedule.name': ['eq', 'in'],
  'schedule.state': ['eq', 'in'],
  'schedule.frequency': ['eq', 'in'],
  'schedule.nextRunAt': ['eq', 'gt', 'gte', 'lt', 'lte'],
  'schedule.createdAt': ['eq', 'gt', 'gte', 'lt', 'lte'],
  'schedule.updatedAt': ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateExtractRefreshTasksFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Apply client-side filtering to extract refresh tasks based on filter expressions.
 * Supports field:operator:value syntax (e.g., "schedule.frequency:eq:Daily")
 */
export function applyTaskFilters(
  tasks: ExtractRefreshTask[],
  filterString: string | undefined,
): ExtractRefreshTask[] {
  if (!filterString) {
    return tasks;
  }

  // Parse and validate the filter string
  const validatedFilter = parseAndValidateExtractRefreshTasksFilterString(filterString);
  const filters = validatedFilter.split(',').map((f) => {
    const [field, operator, ...valueParts] = f.split(':');
    return {
      field: field as FilterField,
      operator: operator as FilterOperator,
      value: valueParts.join(':'),
    };
  });

  return tasks.filter((task) => {
    return filters.every(({ field, operator, value }) => {
      const fieldValue = getFieldValue(task, field);
      return matchesFilter(fieldValue, operator, value);
    });
  });
}

function getFieldValue(task: ExtractRefreshTask, field: FilterField): string | number | undefined {
  switch (field) {
    case 'id':
      return task.id;
    case 'type':
      return task.type;
    case 'priority':
      return task.priority;
    case 'consecutiveFailedCount':
      return task.consecutiveFailedCount;
    case 'datasource.id':
      return task.datasource?.id;
    case 'workbook.id':
      return task.workbook?.id;
    case 'schedule.id':
      return task.schedule?.id;
    case 'schedule.name':
      return task.schedule?.name;
    case 'schedule.state':
      return task.schedule?.state;
    case 'schedule.frequency':
      return task.schedule?.frequency;
    case 'schedule.nextRunAt':
      return task.schedule?.nextRunAt;
    case 'schedule.createdAt':
      return task.schedule?.createdAt;
    case 'schedule.updatedAt':
      return task.schedule?.updatedAt;
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
  applyTaskFilters,
  getFieldValue,
  matchesFilter,
};
