import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getContentWorkbooksTool } from './contentWorkbooks.js';

describe('content-workbooks tool', () => {
  it('should have correct tool name', () => {
    const tool = getContentWorkbooksTool(new Server());
    expect(tool.name).toBe('content-workbooks');
  });

  it('should have correct annotations', () => {
    const tool = getContentWorkbooksTool(new Server());
    expect(tool.annotations?.title).toBe('Content — Workbooks');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getContentWorkbooksTool(new Server());
    expect(tool.description).toContain('Tableau workbooks on the site');
  });
});
