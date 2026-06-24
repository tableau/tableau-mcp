import { EXTRACT_REFRESH_JOB_TYPES, JOB_PERFORMANCE_FIELDS } from './jobPerformance.js';

describe('JOB_PERFORMANCE_FIELDS', () => {
  it('contains the 10 fields needed for the optimization read', () => {
    expect(JOB_PERFORMANCE_FIELDS).toEqual([
      'Item Name',
      'Job Type',
      'Job Result',
      'Started At',
      'Job Duration',
      'Job Execution Duration',
      'Schedule Name',
      'Was Manual Run',
      'Error Message',
      'Extract File Size',
    ]);
  });

  it('has no duplicates and no empty entries', () => {
    expect(new Set(JOB_PERFORMANCE_FIELDS).size).toBe(JOB_PERFORMANCE_FIELDS.length);
    for (const field of JOB_PERFORMANCE_FIELDS) {
      expect(field).toMatch(/\S/);
    }
  });
});

describe('EXTRACT_REFRESH_JOB_TYPES', () => {
  it('covers direct and Bridge variants of both full and incremental refresh', () => {
    expect(EXTRACT_REFRESH_JOB_TYPES).toEqual([
      'RefreshExtracts',
      'IncrementExtracts',
      'RefreshExtractsViaBridge',
      'IncrementExtractsViaBridge',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(EXTRACT_REFRESH_JOB_TYPES).size).toBe(EXTRACT_REFRESH_JOB_TYPES.length);
  });
});
