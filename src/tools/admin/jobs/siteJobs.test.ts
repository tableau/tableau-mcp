import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getSiteJobsTool } from './siteJobs.js';

describe('site-jobs tool', () => {
  it('should have correct tool name', () => {
    const tool = getSiteJobsTool(new Server());
    expect(tool.name).toBe('site-jobs');
  });

  it('should have correct annotations', () => {
    const tool = getSiteJobsTool(new Server());
    expect(tool.annotations?.title).toBe('Site jobs');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getSiteJobsTool(new Server());
    expect(tool.description).toContain('Query active background jobs');
  });
});
