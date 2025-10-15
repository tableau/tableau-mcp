import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { callTool } from './client.js';

describe('search-content', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should search content', async () => {
    const env = getDefaultEnv();

    const searchResults = await callTool('search-content', {
      env,
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
