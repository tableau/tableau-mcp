import { describe, expect, it } from 'vitest';

import { parseListJobsResponse } from './jobsApi.js';

const pagination = { pageNumber: '1', pageSize: '100', totalAvailable: '0' };

describe('parseListJobsResponse', () => {
  it('accepts Tableau empty backgroundJobs: {} by normalizing to backgroundJob: []', () => {
    const data = parseListJobsResponse({ pagination, backgroundJobs: {} });
    expect(data.backgroundJobs).toEqual({ backgroundJob: [] });
  });

  it('does not change responses that already include backgroundJob as array', () => {
    const job = { id: 'j1', jobType: 'refresh_extracts', status: 'Success' };
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: { backgroundJob: [job] },
    });
    expect(data.backgroundJobs).toEqual({ backgroundJob: [job] });
  });

  it('normalizes a single backgroundJob object to an array', () => {
    const job = { id: 'j1', jobType: 'refresh_extracts', status: 'Success' };
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: { backgroundJob: job },
    });
    expect(data.backgroundJobs).toEqual({ backgroundJob: [job] });
  });

  it('coerces numeric priority and progress from strings to numbers', () => {
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: {
        backgroundJob: { id: 'j1', priority: '50', progress: '100' },
      },
    });
    expect(data.backgroundJobs).toEqual({
      backgroundJob: [{ id: 'j1', priority: 50, progress: 100 }],
    });
  });

  it('parses pagination values', () => {
    const data = parseListJobsResponse({
      pagination: { pageNumber: '2', pageSize: '50', totalAvailable: '120' },
      backgroundJobs: {},
    });
    expect(data.pagination).toEqual({ pageNumber: 2, pageSize: 50, totalAvailable: 120 });
  });

  // A *single* malformed job object (missing required `id`) does not match the
  // single-object branch, so it falls through to the non-strict `z.object({})`
  // fallback and is normalized to an empty list rather than throwing.
  it('drops a single malformed job (missing id) via the empty fallback branch', () => {
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: { backgroundJob: { jobType: 'refresh_extracts' } },
    });
    expect(data.backgroundJobs).toEqual({ backgroundJob: [] });
  });

  // Element tolerance: a single bad element in an array must not discard the
  // whole page. Valid jobs survive; only the malformed one is dropped.
  it('keeps valid jobs in an array when one element is malformed', () => {
    const good1 = { id: 'j1', jobType: 'refresh_extracts', status: 'Success' };
    const good2 = { id: 'j2', jobType: 'refresh_extracts', status: 'Failed' };
    const bad = { jobType: 'refresh_extracts' }; // missing required id
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: { backgroundJob: [good1, bad, good2] },
    });
    expect(data.backgroundJobs).toEqual({ backgroundJob: [good1, good2] });
  });

  it('keeps all jobs when an array is fully valid', () => {
    const jobs = [
      { id: 'j1', jobType: 'refresh_extracts' },
      { id: 'j2', jobType: 'run_flow' },
    ];
    const data = parseListJobsResponse({
      pagination,
      backgroundJobs: { backgroundJob: jobs },
    });
    expect(data.backgroundJobs).toEqual({ backgroundJob: jobs });
  });
});
