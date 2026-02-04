import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';

import { queryOutputSchema } from '../../src/sdks/tableau/apis/vizqlDataServiceApi';
import invariant from '../../src/utils/invariant.js';
import { Datasource } from '../constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { getCallToolResult, getMcpServer, getModel, getToolExecutions } from './base.js';
import { gradeQuery } from './gradeQuery.js';

describe('query-datasource', () => {
  let mcpServer: MCPServerStdio;
  let superstore: Datasource;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'tests/eval/.env' });
  });

  beforeEach(async () => {
    const env = getDefaultEnv();
    superstore = getSuperstoreDatasource(env);
    mcpServer = await getMcpServer(env);
  });

  afterEach(async () => {
    await mcpServer.close();
  });

  it('Superstore query #1', async () => {
    // getting datasource metadata to provide as context in the prompt
    const getDatasourceMetadataCallToolResult = await mcpServer.callTool(
      'get-datasource-metadata',
      {
        datasourceLuid: superstore.id,
      },
    );

    const prompt = `From the data source with ID ${superstore.id}, what states had the most profit in 2023? Here is the metadata of the data source: ${getDatasourceMetadataCallToolResult[0].text}`;

    const { agentResult } = await gradeQuery({
      mcpServer,
      model: getModel(),
      prompt,
      solution: {
        datasourceLuid: superstore.id,
        query: {
          fields: [
            { fieldCaption: 'State/Province', fieldAlias: 'State' },
            {
              fieldCaption: 'Profit',
              function: 'SUM',
              sortDirection: 'DESC',
              sortPriority: 1,
              fieldAlias: 'Total Profit',
            },
          ],
          filters: [
            {
              field: {
                fieldCaption: 'Order Date',
              },
              filterType: 'QUANTITATIVE_DATE',
              quantitativeFilterType: 'RANGE',
              minDate: '2023-01-01',
              maxDate: '2023-12-31',
            },
          ],
        },
        importantDetails:
          'The results from the solution query are in descending order based on the total profit for each state in 2023. Knowing the profit for each state is not critical to answer the prompt, but it is useful information. From the results, we should know that New York had the most profit in 2023 followed by California, Washington, Michigan, Georgia...',
      },
    });

    const toolExecutions = await getToolExecutions(agentResult);
    expect(toolExecutions.length).toBeGreaterThanOrEqual(1);

    invariant(
      toolExecutions.every((toolExecution) => toolExecution.name === 'query_datasource'),
      'should only call query_datasource',
    );

    const queryDatasourceToolExecution = toolExecutions.find((toolExecution) => {
      return toolExecution.name === 'query_datasource';
    });

    invariant(queryDatasourceToolExecution, 'query-datasource tool execution not found');

    const { datasourceLuid, query } = queryDatasourceToolExecution.arguments;
    expect(datasourceLuid).toBe(superstore.id);
    expect(query).toMatchObject({
      fields: [{ fieldCaption: 'State' }],
      filters: [{ field: { fieldCaption: 'Profit' }, filterType: 'TOP', howMany: 5 }],
    });

    const queryDatasourceToolResult = getCallToolResult(
      queryDatasourceToolExecution,
      queryOutputSchema,
    );
    expect(queryDatasourceToolResult.length).toBeGreaterThan(0);
  });
});
