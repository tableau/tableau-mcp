/**
 * Shared constants for prompts that query the `query-admin-insights-job-performance` tool.
 *
 * Centralized so the field list and the extract-refresh job-type set stay byte-for-byte identical
 * across the inform (`job-optimization-inform`) and apply (`extract-optimization-apply`) prompts.
 * A divergence would mean the Apply step recommends actions against rows the inform step never
 * surfaced — the recommendation column could drift from the data the operator just reviewed.
 */

/**
 * Fields requested for any optimization read against `query-admin-insights-job-performance`. This
 * 10-field set is the minimum needed to compute duration outliers, failure counts, and last-success
 * windows without a second round trip.
 */
export const JOB_PERFORMANCE_FIELDS = [
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
] as const;

/**
 * Raw `Job Type` values as stored in the Admin Insights datasource (no spaces). Extract refresh
 * spans direct and Bridge variants, so the default scope is all four. These match the job types
 * whose schedules `update-cloud-extract-refresh-task` / `delete-extract-refresh-task` can act on.
 */
export const EXTRACT_REFRESH_JOB_TYPES = [
  'RefreshExtracts',
  'IncrementExtracts',
  'RefreshExtractsViaBridge',
  'IncrementExtractsViaBridge',
] as const;
