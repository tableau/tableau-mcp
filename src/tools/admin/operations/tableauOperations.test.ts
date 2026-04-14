import { describe, expect, it } from 'vitest';

import { Server } from '../../../server.js';
import { getTableauOperationsTool } from './tableauOperations.js';

describe('tableau-operations tool', () => {
  it('should have correct tool name', () => {
    const tool = getTableauOperationsTool(new Server());
    expect(tool.name).toBe('tableau-operations');
  });

  it('should have correct annotations', () => {
    const tool = getTableauOperationsTool(new Server());
    expect(tool.annotations?.title).toBe('Tableau operations');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(true);
  });

  it('should have correct description', () => {
    const tool = getTableauOperationsTool(new Server());
    expect(tool.description).toContain('Higher-level Tableau Cloud operations');
  });
});
