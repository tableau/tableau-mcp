import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';

import { Query } from '../../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { getAgent, getToolExecutions, log } from './base.js';
import { evaluationSchema } from './evaluationResult.js';
import { promptAgent } from './grade.js';

type GradeQueryInput = {
  mcpServer: MCPServerStdio;
  model: string;
  prompt: string;
  solution: {
    datasourceLuid: string;
    query: Query;
    importantDetails: string;
  };
};

const evalSystemPrompt = `
  You are an expert evaluator assessing how well an LLM answers a given question.
  The LLM answers the question by querying a data source
  `;

export async function gradeQuery({
  mcpServer,
  model,
  prompt,
  solution,
}: GradeQueryInput): Promise<{ agentResult: StreamedRunResult<any, any> }> {
  const solutionQueryDatasourceCallToolResult = await mcpServer.callTool('query-datasource', {
    datasourceLuid: solution.datasourceLuid,
    query: solution.query,
  });

  const solutionQueryResultText = solutionQueryDatasourceCallToolResult[0].text;

  const evals = await promptAgent({ mcpServer, model, prompt });
  const toolExecutions = await getToolExecutions(evals);
  const queryDatasourceToolExecutions = toolExecutions.filter(
    (toolExecution) => toolExecution.name === 'query-datasource',
  );

  if (queryDatasourceToolExecutions.length === 0) {
    throw new Error('No query-datasource tool execution found');
  }

  const queryDatasourceToolExecution = queryDatasourceToolExecutions[0];
  const { datasourceLuid, query } = queryDatasourceToolExecution.arguments;
  expect(datasourceLuid).toBe(solution.datasourceLuid);
  expect(query).toMatchObject(solution.query);

  log('\n');

  const evalAgentPrompt = `
    Here is the user input: ${prompt}
    Here is an example query that fetches data needed to answer the user's prompt: ${solution.query}
    Here are the results of the example query: ${solutionQueryResultText}
    Here are important details about the solution: ${solution.importantDetails}
    Here is the LLM's answer: ${evals.finalOutput}`;

  const evalAgent = await getAgent({
    model,
    systemPrompt: evalSystemPrompt,
  });

  const result = await withTrace('run_eval_agent', async () => {
    const stream = await run(evalAgent, evalAgentPrompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await stream.completed;
    return stream;
  });

  log('\n');

  const jsonRegexes = [/(?<JSON>\{[^}]+\})/];
  for (const jsonRegex of jsonRegexes) {
    const match = result.finalOutput?.match(jsonRegex);
    if (match) {
      const evaluationResult = evaluationSchema.safeParse(JSON.parse(match.groups?.JSON ?? '{}'));
      if (!evaluationResult.success) {
        throw new Error(
          `Could not parse agent output as an evaluation result:\n${result.finalOutput}`,
        );
      }

      const evaluation = evaluationResult.data;
      expect(evaluation.accuracy).toBeGreaterThanOrEqual(4);
      expect(evaluation.completeness).toBeGreaterThanOrEqual(4);
      expect(evaluation.relevance).toBeGreaterThanOrEqual(4);
      expect(evaluation.clarity).toBeGreaterThanOrEqual(4);
      expect(evaluation.reasoning).toBeGreaterThanOrEqual(4);

      return {
        agentResult: evals,
      };
    }
  }
  throw new Error('Could not parse JSON from agent output');
}
