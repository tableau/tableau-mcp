import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getContentPermissionsTool } from './contentPermissions.js';

describe('content-permissions tool', () => {
  it('should have correct tool name', () => {
    const tool = getContentPermissionsTool(new Server());
    expect(tool.name).toBe('content-permissions');
  });

  it('should have correct annotations', () => {
    const tool = getContentPermissionsTool(new Server());
    expect(tool.annotations?.title).toBe('Content permissions');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getContentPermissionsTool(new Server());
    expect(tool.description).toContain('Tableau REST API permissions');
  });
});
