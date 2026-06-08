// Optimization signals the model computes from the returned rows. These are
// type-agnostic and apply to any job type.
const GENERIC_NOTES = [
  'Failure rate: share of `Job Result` = Failed/Error, grouped by Item and Schedule.',
  'Long runners: highest `Job Duration` and `Job Execution Duration` outliers.',
  'Queue pressure: large gaps between `Job Duration` and `Job Execution Duration`.',
  'Manual vs scheduled: `Was Manual Run` = true with no `Schedule Name`.',
  'Overlap: jobs sharing a `Started At` window that compete for capacity.',
];

// Per-job-type tuning. Add a key to give a job type sharper guidance; any type
// without a key falls back to the generic notes, so new types are supported
// without a code change.
const NOTES_BY_JOB_TYPE: Record<string, string[]> = {
  'Refresh Extracts': [
    'Consecutive failures: repeated Failed `Job Result` for the same Item — candidate to pause or repair.',
    'Over-refresh: scheduled far more often than the source changes — widen the interval.',
    'Long extracts: high `Job Duration` with large `Extract File Size` — consider an incremental refresh.',
    ...GENERIC_NOTES,
  ],
};

export const renderNotesFor = (jobType: string): string[] =>
  NOTES_BY_JOB_TYPE[jobType] ?? GENERIC_NOTES;
