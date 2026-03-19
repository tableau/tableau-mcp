import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';

import { getAgent, log } from './base.js';
import { evaluationSchema } from './evaluationResult.js';

type GradeInput = {
  mcpServer: MCPServerStdio;
  model: string;
  prompt: string;
};

const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

const evalSystemPrompt = `
  You are an expert evaluator assessing how well an LLM answers a given question.
  Review the provided answer and score it from 1 to 5 in each of the following categories:
    Accuracy - Does the answer contain factual errors or hallucinations?
    Completeness - Does the answer fully address all parts of the question?
    Relevance - Is the information directly related to the question?
    Clarity - Is the explanation easy to understand and well-structured?
    Reasoning - Does the answer show logical thinking or provide evidence or rationale?
    Return your evaluation as a JSON object in the format:
    {
        "accuracy": 1-5,
        "completeness": 1-5,
        "relevance": 1-5,
        "clarity": 1-5,
        "reasoning": 1-5,
        "comments": "A short paragraph summarizing the strengths and weaknesses of the answer."
    }`;

export async function grade({
  mcpServer,
  model,
  prompt,
}: GradeInput): Promise<{ agentResult: StreamedRunResult<any, any> }> {
  const evals = await promptAgent({ mcpServer, model, prompt });
  log('\n');

  const evalAgentPrompt = `
    Here is the user input: ${prompt}
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

async function promptAgent({
  mcpServer,
  model,
  prompt,
}: GradeInput): Promise<StreamedRunResult<any, any>> {
  log(`Evaluating prompt: ${prompt}`, true);

  const agentWithTools = await getAgent({
    mcpServer,
    model,
    systemPrompt: agentSystemPrompt,
  });

  const result = await withTrace('run_agent_with_tools', async () => {
    const stream = await run(agentWithTools, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await stream.completed;
    return stream;
  });

  return result;
}
