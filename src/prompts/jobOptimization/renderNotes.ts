// Optimization signals the model computes from the returned rows. These are
// type-agnostic and apply to any job type.
const GENERIC_NOTES = [
  'Failure rate: share of `Job Result` = Failed/Error, grouped by Item and Schedule.',
  'Long runners: highest `Job Duration` and `Job Execution Duration` outliers.',
  'Queue pressure: large gaps between `Job Duration` and `Job Execution Duration`.',
  'Manual vs scheduled: `Was Manual Run` = true with no `Schedule Name`.',
  'Overlap: jobs sharing a `Started At` window that compete for capacity.',
];

const EXTRACT_NOTES = [
  'Consecutive failures: repeated Failed `Job Result` for the same Item — candidate to pause or repair.',
  'Over-refresh: scheduled far more often than the source changes — widen the interval.',
  'Long extracts: high `Job Duration` with large `Extract File Size` — consider an incremental refresh.',
  ...GENERIC_NOTES,
];

// Returns guidance tuned to the job types under analysis. Extract refresh types
// (which contain "Extract" in their raw value) get extract-specific notes; any
// other type falls back to generic notes, so new types need no code change.
export const renderNotesFor = (jobTypeValues: ReadonlyArray<string>): string[] =>
  jobTypeValues.some((value) => value.includes('Extract')) ? EXTRACT_NOTES : GENERIC_NOTES;
