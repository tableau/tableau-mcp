import { z } from 'zod';

import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import {
  applyClientSideFilters,
  matchesClientSideFilter,
} from '../../../../utils/clientSideFilter.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
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
  return applyClientSideFilters({
    items: tasks,
    filterString,
    validateFilterString: parseAndValidateFlowTasksFilterString,
    getFieldValue,
  });
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

export const exportedForTesting = {
  FilterFieldSchema,
  applyFlowTaskFilters,
  getFieldValue,
  matchesFilter: matchesClientSideFilter,
};
