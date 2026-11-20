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

    it('should match null members with null in SET filter values', async () => {
      // Superstore has no null Category, so make one.
      const calculation = "IF [Category] = 'Furniture' THEN NULL ELSE [Category] END";
      const queryWithSetValues = async (values?: Array<string | null>): Promise<unknown[]> => {
        const rows = await query({
          fields: [{ fieldCaption: 'Category Or Null', calculation }],
          ...(values ? { filters: [{ field: { calculation }, filterType: 'SET', values }] } : {}),
        });
        return rows.map((row) => row['Category Or Null']).sort();
      };

      expect(await queryWithSetValues()).toEqual(['Office Supplies', 'Technology', null]);
      expect(await queryWithSetValues([null])).toEqual([null]);
      expect(await queryWithSetValues(['Office Supplies', null])).toEqual([
        'Office Supplies',
        null,
      ]);
    });
  });

  describe('VDS QueryRequest envelope', () => {
    const resultSchema = z.object({
      data: z.array(z.record(z.unknown())),
      mcp: z
        .object({
          warnings: z
            .array(z.object({ type: z.string(), affectedProperties: z.array(z.string()) }))
            .optional(),
          resultInfo: z.object({ truncated: z.boolean() }).passthrough().optional(),
        })
        .optional(),
    });
    const salesByCategory = {
      fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'Sales', function: 'SUM' }],
    };

    async function queryRequest(
      query: Record<string, unknown>,
      options: Record<string, unknown>,
    ): Promise<z.infer<typeof resultSchema>> {
      return client.callTool('query-datasource', {
        schema: resultSchema,
        toolArgs: {
          datasource: { datasourceLuid: getSuperstoreDatasource(getDefaultEnv()).id },
          query,
          options,
        },
      });
    }

    it('runs a pasted request as written', async () => {
      const result = await queryRequest(
        { fields: [{ fieldCaption: 'Customer Name' }, { fieldCaption: 'Sales', function: 'SUM' }] },
        { returnFormat: 'OBJECTS', debug: true, rowLimit: 3, disaggregate: false },
      );

      expect(result.data).toHaveLength(3);
      expect(result.mcp?.resultInfo?.truncated).toBe(true);
      expect(result.mcp?.warnings).toBeUndefined();
    });

    it('forwards disaggregate, which returns record-level rows', async () => {
      const aggregated = await queryRequest(salesByCategory, { rowLimit: 10, disaggregate: false });
      const disaggregated = await queryRequest(salesByCategory, {
        rowLimit: 10,
        disaggregate: true,
      });

      // Superstore has 3 categories; a row per record far exceeds the limit.
      expect(aggregated.data).toHaveLength(3);
      expect(aggregated.mcp?.resultInfo?.truncated).toBe(false);
      expect(disaggregated.data).toHaveLength(10);
      expect(disaggregated.mcp?.resultInfo?.truncated).toBe(true);
    });

    it('keeps OBJECTS rows and warns when returnFormat differs', async () => {
      const result = await queryRequest(salesByCategory, { returnFormat: 'ARRAYS' });

      expect(result.data.length).toBeGreaterThan(0);
      for (const row of result.data) expect(row).toHaveProperty('Category');
      expect(result.mcp?.warnings).toEqual([
        { type: 'IGNORED_REQUEST_PROPERTY', affectedProperties: ['options.returnFormat'] },
      ]);
    });

    it('rejects an unknown option by name', async () => {
      const result = await client.client.callTool({
        name: 'query-datasource',
        arguments: {
          datasource: { datasourceLuid: getSuperstoreDatasource(getDefaultEnv()).id },
          query: salesByCategory,
          options: { foo: 1 },
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('options.foo');
    });
  });
});
