import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import {
  applyFlowTaskFilters,
  parseAndValidateFlowTasksFilterString,
} from './flowTasksFilterUtils.js';
import { mockFlowRunTasks } from './mockFlowRunTasks.js';

describe('parseAndValidateFlowTasksFilterString', () => {
  it('accepts valid fields and operators', () => {
    expect(parseAndValidateFlowTasksFilterString('flow.name:eq:Daily')).toBe('flow.name:eq:Daily');
    expect(parseAndValidateFlowTasksFilterString('consecutiveFailedCount:gt:0')).toBe(
      'consecutiveFailedCount:gt:0',
    );
  });

  it('rejects unknown fields', () => {
    expect(() => parseAndValidateFlowTasksFilterString('datasource.id:eq:x')).toThrow();
  });

  it('rejects disallowed operators', () => {
    expect(() => parseAndValidateFlowTasksFilterString('flow.name:gt:x')).toThrow();
  });
});

describe('applyFlowTaskFilters', () => {
  it('returns all tasks when no filter is supplied', () => {
    expect(applyFlowTaskFilters(mockFlowRunTasks, undefined)).toEqual(mockFlowRunTasks);
  });

  it('filters by flow.id (eq)', () => {
    const result = applyFlowTaskFilters(
      mockFlowRunTasks,
      'flow.id:eq:8a320dca-9151-41ea-8474-a0bb71961cc0',
    );
    expect(result).toHaveLength(1);
    expect(result[0].flow?.name).toBe('allUseCaseTFLX2');
  });

  it('filters by schedule.state (in: bracket/comma form, repo-canonical)', () => {
    expect(applyFlowTaskFilters(mockFlowRunTasks, 'schedule.state:in:[Active]')).toHaveLength(1);
    expect(
      applyFlowTaskFilters(mockFlowRunTasks, 'schedule.state:in:[Active,Suspended]'),
    ).toHaveLength(2);
  });

  it('filters by schedule.state (in: legacy pipe form, still accepted)', () => {
    expect(applyFlowTaskFilters(mockFlowRunTasks, 'schedule.state:in:Active')).toHaveLength(1);
    expect(
      applyFlowTaskFilters(mockFlowRunTasks, 'schedule.state:in:Active|Suspended'),
    ).toHaveLength(2);
  });

  it('keeps a bracketed in: list intact when combined with another filter (AND)', () => {
    // The comma inside [Active,Suspended] must NOT be treated as a clause
    // separator; the bracket and pipe forms must yield identical results.
    const bracket = applyFlowTaskFilters(
      mockFlowRunTasks,
      'schedule.state:in:[Active,Suspended],consecutiveFailedCount:gte:0',
    );
    const pipe = applyFlowTaskFilters(
      mockFlowRunTasks,
      'schedule.state:in:Active|Suspended,consecutiveFailedCount:gte:0',
    );
    expect(bracket).toEqual(pipe);
  });

  it('filters by numeric consecutiveFailedCount (gt)', () => {
    const result = applyFlowTaskFilters(mockFlowRunTasks, 'consecutiveFailedCount:gt:0');
    expect(result).toHaveLength(1);
    expect(result[0].consecutiveFailedCount).toBe(2);
  });

  it('combines multiple filters with AND', () => {
    const result = applyFlowTaskFilters(
      mockFlowRunTasks,
      'schedule.frequency:eq:Daily,schedule.state:eq:Suspended',
    );
    expect(result).toHaveLength(1);
    expect(result[0].schedule?.frequency).toBe('Daily');
  });

  it('returns no tasks when a field is missing on every task', () => {
    const tasksWithoutFlow: FlowRunTask[] = [{ id: 't1' }];
    expect(applyFlowTaskFilters(tasksWithoutFlow, 'flow.id:eq:anything')).toHaveLength(0);
  });
});
