import { Job } from '../../../sdks/tableau/types/job.js';

export const mockJob: Job = {
  id: 'job-123',
  status: 'Success',
  jobType: 'refresh_extracts',
  priority: 50,
  createdAt: '2026-05-20T10:00:00Z',
  startedAt: '2026-05-20T10:00:05Z',
  endedAt: '2026-05-20T10:05:00Z',
  progress: 100,
  title: 'Refreshing Sales Data',
};
