import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getAdminUsersTool } from './adminUsers.js';

describe('admin-users tool', () => {
  it('should have correct tool name', () => {
    const tool = getAdminUsersTool(new Server());
    expect(tool.name).toBe('admin-users');
  });

  it('should have correct annotations', () => {
    const tool = getAdminUsersTool(new Server());
    expect(tool.annotations?.title).toBe('Admin Users');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getAdminUsersTool(new Server());
    expect(tool.description).toContain('Administrative Tableau users tool');
  });
});
