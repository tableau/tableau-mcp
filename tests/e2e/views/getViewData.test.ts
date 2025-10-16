import z from 'zod';

import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('get-view-data', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should get view data', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const data = await callTool('get-view-data', {
      env,
      schema: z.string(),
      toolArgs: { viewId: superstore.defaultViewId },
    });

    const lines = data.split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toBe(
      'Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)',
    );

    const firstRowColumns = lines[1].split(',');
    expect(firstRowColumns.length).toBeGreaterThan(0);
    expect(firstRowColumns[0], 'Country/Region').toMatch(/^\S+$/);
    expect(firstRowColumns[1], 'State/Province').toMatch(/^\S+$/);
    expect(firstRowColumns[2], 'Profit Ratio').toMatch(/^[-0-9.]+%$/);
    expect(firstRowColumns[3], 'Latitude (generated)').toMatch(/^[-0-9.]+$/);
    expect(firstRowColumns[4], 'Longitude (generated)').toMatch(/^[-0-9.]+$/);
  });
});
