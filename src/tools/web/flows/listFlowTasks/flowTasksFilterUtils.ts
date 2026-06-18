import { z } from 'zod';

import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
  splitTopLevel,
} from '../../../../utils/parseAndValidateFilterString.js';

// Client-side filtering for flow run tasks. The Tableau "Get Flow Run Tasks"
// endpoint (GET /sites/:siteId/tasks/runFlow) does not support server-side
// filtering or pagination, so all tasks are fetched and filtered here.

const FilterFieldSchema = z.enum([
  'id',
  'type',
  'priority',
  'consecutiveFailedCount',
  'flow.id',
  'flow.name',
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
  'flow.id': ['eq', 'in'],
  'flow.name': ['eq', 'in'],
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

export function parseAndValidateFlowTasksFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Apply client-side filtering to flow run tasks based on filter expressions.
 * Supports field:operator:value syntax (e.g., "schedule.frequency:eq:Daily").
 * The `in` operator accepts the repo-canonical bracket/comma list
 * (e.g. "schedule.state:in:[Active,Suspended]") as well as the legacy
 * pipe-delimited form ("schedule.state:in:Active|Suspended").
 */
export function applyFlowTaskFilters(
  tasks: FlowRunTask[],
  filterString: string | undefined,
): FlowRunTask[] {
  if (!filterString) {
    return tasks;
  }

  const validatedFilter = parseAndValidateFlowTasksFilterString(filterString);
  // splitTopLevel (not a naive comma split) so a bracketed `in` list such as
  // "[Active,Suspended]" is kept intact instead of being shredded into broken
  // sub-expressions ("[Active" / "Suspended]").
  const filters = splitTopLevel(validatedFilter, ',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => {
      const [field, operator, ...valueParts] = f.split(':');
      return {
        field: field as FilterField,
        operator: operator as FilterOperator,
        value: valueParts.join(':'),
      };
    });

  return tasks.filter((task) =>
    filters.every(({ field, operator, value }) =>
      matchesFilter(getFieldValue(task, field), operator, value),
    ),
  );
}

/**
 * Expand an `in` operator value into its candidate list. Accepts both the
 * repo-canonical bracket/comma form `[A,B]` (used by list-flow-runs and every
 * other list-* tool) and the legacy pipe form `A|B`, so a filter that works on
 * a sibling tool does not silently match nothing here.
 */
function parseInValues(value: string): string[] {
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return inner
    .split(/[,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function getFieldValue(task: FlowRunTask, field: FilterField): string | number | undefined {
  switch (field) {
    case 'id':
      return task.id;
    case 'type':
      return task.type;
    case 'priority':
      return task.priority;
    case 'consecutiveFailedCount':
      return task.consecutiveFailedCount;
    case 'flow.id':
      return task.flow?.id;
    case 'flow.name':
      return task.flow?.name;
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
      return parseInValues(filterValue).includes(fieldStr);
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
  applyFlowTaskFilters,
  getFieldValue,
  matchesFilter,
};
