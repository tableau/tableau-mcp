import z from 'zod';

import { queryOutputSchema } from '../../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('query-datasource', () => {
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

  it('should query datasource', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { data } = await client.callTool('query-datasource', {
      schema: queryOutputSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
        query: { fields: [{ fieldCaption: 'Postal Code' }] },
      },
    });

    const postalCodes = z.array(z.object({ 'Postal Code': z.string() })).parse(data);
    expect(postalCodes.length).toBeGreaterThan(0);
  });

  describe('VDS query features', () => {
    async function query(query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
      const { data } = await client.callTool('query-datasource', {
        schema: queryOutputSchema,
        toolArgs: { datasourceLuid: getSuperstoreDatasource(getDefaultEnv()).id, query },
      });
      return z.array(z.record(z.unknown())).parse(data);
    }

    it('should rank a measure with a table calc', async () => {
      const rows = z
        .array(z.object({ Category: z.string(), Sales: z.number(), 'Sales Rank': z.number() }))
        .parse(
          await query({
            fields: [
              { fieldCaption: 'Category' },
              { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
              {
                fieldCaption: 'Sales',
                function: 'SUM',
                fieldAlias: 'Sales Rank',
                tableCalculation: {
                  tableCalcType: 'RANK',
                  dimensions: [{ fieldCaption: 'Category' }],
                },
              },
            ],
          }),
        );

      expect(rows.length).toBeGreaterThan(1);
      const bySales = [...rows].sort((a, b) => b.Sales - a.Sales);
      expect(bySales.map((row) => row['Sales Rank'])).toEqual(rows.map((_, i) => i + 1));
    });

    it('should compute a running total with a table calc', async () => {
      const year = { fieldCaption: 'Order Date', function: 'YEAR' };
      const rows = z
        .array(z.object({ Year: z.number(), Sales: z.number(), 'Running Sales': z.number() }))
        .parse(
          await query({
            fields: [
              { ...year, fieldAlias: 'Year', sortDirection: 'ASC', sortPriority: 1 },
              { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
              {
                fieldCaption: 'Sales',
                function: 'SUM',
                fieldAlias: 'Running Sales',
                tableCalculation: { tableCalcType: 'RUNNING_TOTAL', dimensions: [year] },
              },
            ],
          }),
        );

      expect(rows.length).toBeGreaterThan(1);
      let runningTotal = 0;
      for (const row of [...rows].sort((a, b) => a.Year - b.Year)) {
        runningTotal += row.Sales;
        expect(row['Running Sales']).toBeCloseTo(runningTotal, 2);
      }
    });

    it('should filter by a CONDITION', async () => {
      const allCustomers = await query({ fields: [{ fieldCaption: 'Customer Name' }] });
      const rows = z.array(z.object({ 'Customer Name': z.string(), Sales: z.number() })).parse(
        await query({
          fields: [
            { fieldCaption: 'Customer Name' },
            { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
          ],
          filters: [
            {
              field: { fieldCaption: 'Customer Name' },
              filterType: 'CONDITION',
              condition: {
                fieldCaption: 'Sales',
                function: 'SUM',
                comparison: '>',
                value: 10000,
              },
            },
          ],
        }),
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(allCustomers.length);
      for (const row of rows) {
        expect(row.Sales).toBeGreaterThan(10000);
      }
    });

    it('should accept null in SET filter values', async () => {
      const rows = await query({
        fields: [{ fieldCaption: 'Category' }],
        filters: [
          { field: { fieldCaption: 'Category' }, filterType: 'SET', values: ['Furniture', null] },
        ],
      });

      expect(rows).toEqual([{ Category: 'Furniture' }]);
    });
  });
});
