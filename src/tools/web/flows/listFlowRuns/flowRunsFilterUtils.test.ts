import { FlowRun } from '../../../../sdks/tableau/types/flow.js';
import {
  extractFlowIdEqValue,
  looksLikeUuid,
  parseAndValidateFlowRunsFilterString,
} from './flowRunsFilterUtils.js';

const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';

function run(status: FlowRun['status']): FlowRun {
  return { id: 'r', flowId: FLOW_ID, status };
}

describe('parseAndValidateFlowRunsFilterString', () => {
  it('keeps server-side fields in serverFilter and accepts all statuses when no status clause', () => {
    const { serverFilter, matchesStatus } = parseAndValidateFlowRunsFilterString(
      `flowId:eq:${FLOW_ID}`,
    );
    expect(serverFilter).toBe(`flowId:eq:${FLOW_ID}`);
    expect(matchesStatus(run('Success'))).toBe(true);
    expect(matchesStatus(run('Failed'))).toBe(true);
  });

  it('strips status into a client-side predicate (eq)', () => {
    const { serverFilter, matchesStatus } =
      parseAndValidateFlowRunsFilterString('status:eq:Failed');
    expect(serverFilter).toBe('');
    expect(matchesStatus(run('Failed'))).toBe(true);
    expect(matchesStatus(run('Success'))).toBe(false);
  });

  it('strips status into a client-side predicate (in:[...])', () => {
    const { serverFilter, matchesStatus } = parseAndValidateFlowRunsFilterString(
      `flowId:eq:${FLOW_ID},status:in:[Failed,Cancelled]`,
    );
    expect(serverFilter).toBe(`flowId:eq:${FLOW_ID}`);
    expect(matchesStatus(run('Failed'))).toBe(true);
    expect(matchesStatus(run('Cancelled'))).toBe(true);
    expect(matchesStatus(run('Success'))).toBe(false);
  });

  it('treats a run with no status as non-matching when a status filter is present', () => {
    const { matchesStatus } = parseAndValidateFlowRunsFilterString('status:eq:Success');
    expect(matchesStatus({ id: 'r' })).toBe(false);
  });

  it('normalizes date-only startedAt/completedAt to midnight UTC', () => {
    const { serverFilter } = parseAndValidateFlowRunsFilterString(
      'startedAt:gt:2025-01-01,completedAt:lt:2025-02-01',
    );
    expect(serverFilter).toContain('startedAt:gt:2025-01-01T00:00:00Z');
    expect(serverFilter).toContain('completedAt:lt:2025-02-01T00:00:00Z');
  });

  it('rejects an unknown status value', () => {
    expect(() => parseAndValidateFlowRunsFilterString('status:eq:Nope')).toThrow(
      /Allowed flow-run/,
    );
  });

  it('rejects a disallowed operator for status', () => {
    expect(() => parseAndValidateFlowRunsFilterString('status:gt:Failed')).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() => parseAndValidateFlowRunsFilterString('owner:eq:x')).toThrow();
  });
});

describe('looksLikeUuid', () => {
  it.each([
    [FLOW_ID, true],
    ['00000000-0000-0000-0000-000000000000', true],
    ['My Daily Flow', false],
    ['not-a-uuid', false],
    ['', false],
  ])('classifies %s as %s', (value, expected) => {
    expect(looksLikeUuid(value)).toBe(expected);
  });
});

describe('extractFlowIdEqValue', () => {
  it.each([
    [`flowId:eq:${FLOW_ID}`, FLOW_ID],
    [`status:eq:Failed,flowId:eq:${FLOW_ID}`, FLOW_ID],
    ['flowId:eq:My Flow', 'My Flow'],
  ])('extracts the value from %s', (input, expected) => {
    expect(extractFlowIdEqValue(input)).toBe(expected);
  });

  it.each([undefined, '', 'status:eq:Failed', 'userId:eq:u1'])(
    'returns undefined when there is no flowId:eq clause: %s',
    (input) => {
      expect(extractFlowIdEqValue(input)).toBeUndefined();
    },
  );
});
