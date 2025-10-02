import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';
import z from 'zod';

import { getAgent, log } from './base.js';
import { runEvals } from './runEvals.js';

export const evaluationSchema = z.object({
  accuracy: z.number(),
  completeness: z.number(),
  relevance: z.number(),
  clarity: z.number(),
  reasoning: z.number(),
  comments: z.string(),
});

export type EvaluationResult = z.infer<typeof evaluationSchema>;

const systemPrompt = `
  You are an expert evaluator assessing how well an LLM answers a given question. Review the provided answer and score it from 1 to 5 in each of the following categories:
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
}: {
  mcpServer: MCPServerStdio;
  model: string;
  prompt: string;
}): Promise<{ agentResult: StreamedRunResult<any, any> }> {
  const evals = await runEvals({ mcpServer, model, prompt });
  log('\n');

  const agentPrompt = `
    Here is the user input: ${prompt}
    Here is the LLM's answer: ${evals.finalOutput}`;

  const agent = await getAgent({
    model,
    systemPrompt,
  });

  const result = await withTrace('run_agent', async () => {
    const stream = await run(agent, agentPrompt, { stream: true });
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
