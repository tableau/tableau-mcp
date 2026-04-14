import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getContentProjectsTool } from './contentProjects.js';

describe('content-projects tool', () => {
  it('should have correct tool name', () => {
    const tool = getContentProjectsTool(new Server());
    expect(tool.name).toBe('content-projects');
  });

  it('should have correct annotations', () => {
    const tool = getContentProjectsTool(new Server());
    expect(tool.annotations?.title).toBe('Content — Projects');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getContentProjectsTool(new Server());
    expect(tool.description).toContain('Tableau site projects');
  });
});
