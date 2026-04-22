import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('search-content', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should search content', async () => {
    const env = getDefaultEnv();

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
