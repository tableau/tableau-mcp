import { z } from 'zod';

import { setEnv } from '../testEnv.js';
import { callTool } from './client.js';

describe('search-content', () => {
  beforeAll(setEnv);

  it('should search content', async () => {
    const searchResults = await callTool('search-content', {
      schema: z.array(z.record(z.string(), z.unknown())),
      toolArgs: {
        terms: 'superstore',
      },
    });

    expect(searchResults.length).toBeGreaterThan(0);

    const searchResultContentTypes = searchResults.map((result) => result.type);
    expect(searchResultContentTypes).toContain('workbook');
    expect(searchResultContentTypes).toContain('datasource');
  });
});
