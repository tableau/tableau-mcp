import { z } from 'zod';

import { expect, test } from './base.js';

test.describe('search-content', () => {
  test('search content', async ({ client }) => {
    const searchResults = await client.callTool('search-content', {
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
