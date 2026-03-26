import dotenv from 'dotenv';
import { z } from 'zod';

import { callTool } from './client.js';

describe('search-content', () => {
  beforeAll(() => {
    dotenv.config();
  });

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
