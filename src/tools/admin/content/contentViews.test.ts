import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getContentViewsTool } from './contentViews.js';

describe('content-views tool', () => {
  it('should have correct tool name', () => {
    const tool = getContentViewsTool(new Server());
    expect(tool.name).toBe('content-views');
  });

  it('should have correct annotations', () => {
    const tool = getContentViewsTool(new Server());
    expect(tool.annotations?.title).toBe('Content — Views');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
  });

  it('should have correct description', () => {
    const tool = getContentViewsTool(new Server());
    expect(tool.description).toContain('Tableau views');
  });
});
