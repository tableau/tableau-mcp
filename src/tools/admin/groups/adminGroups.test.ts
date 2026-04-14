import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getAdminGroupsTool } from './adminGroups.js';

describe('admin-groups tool', () => {
  it('should have correct tool name', () => {
    const tool = getAdminGroupsTool(new Server());
    expect(tool.name).toBe('admin-groups');
  });

  it('should have correct annotations', () => {
    const tool = getAdminGroupsTool(new Server());
    expect(tool.annotations?.title).toBe('Admin Groups');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getAdminGroupsTool(new Server());
    expect(tool.description).toContain('Administrative Tableau groups');
  });
});
