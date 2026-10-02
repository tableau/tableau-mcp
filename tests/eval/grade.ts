import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';

import { getAgent, log } from './base.js';
import { evaluationSchema } from './evaluationResult.js';

type GradeInput = {
  mcpServer: MCPServerStdio;
  model: string;
  prompt: string;
  // Number of full agent+judge attempts. The rubric passes if ANY attempt scores >= 4 in every
  // category; only after all attempts fail do we assert (so the failure reports real scores).
  // Defaults to 1 => behavior is unchanged for existing evals. Raise it for open-ended workflow
  // evals where the single-shot LLM judge is noisy.
  attempts?: number;
  // Delay between attempts (ms) so best-of-N retries don't collide on a low per-minute token quota.
  retryDelayMs?: number;
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

type Evaluation = ReturnType<typeof evaluationSchema.parse>;
type Attempt = { evaluation: Evaluation; agentResult: StreamedRunResult<any, any> };

const passesRubric = (e: Evaluation): boolean =>
  e.accuracy >= 4 && e.completeness >= 4 && e.relevance >= 4 && e.clarity >= 4 && e.reasoning >= 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A rate-limit (429) is transient: a low tokens-per-minute quota is easily exceeded by back-to-back
// attempts. Detect it so we back off and retry rather than failing the whole eval.
const isRateLimit = (error: unknown): boolean => {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === 429 || /rate limit|tokens per min|TPM/i.test(message);
};

export async function grade({
  mcpServer,
  model,
  prompt,
  attempts = 1,
  // Delay before a retry. Sized to let a small (~30k) per-minute token budget refill so best-of-N
  // attempts don't collide with each other on a low-tier key.
  retryDelayMs = 60_000,
}: GradeInput): Promise<{ agentResult: StreamedRunResult<any, any> }> {
  let last: Attempt | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempts > 1) {
      log(`Grading attempt ${attempt}/${attempts}`, true);
    }

    try {
      last = await gradeOnce({ mcpServer, model, prompt });
    } catch (error) {
      // On the last attempt, or for a non-retryable error, let it surface.
      if (attempt >= attempts || !isRateLimit(error)) {
        throw error;
      }
      log(`Attempt ${attempt} hit a rate limit; backing off ${retryDelayMs}ms and retrying.`, true);
      await sleep(retryDelayMs);
      continue;
    }

    if (passesRubric(last.evaluation)) {
      return { agentResult: last.agentResult };
    }

    if (attempt < attempts) {
      log(
        `Attempt ${attempt} did not clear the rubric (${JSON.stringify(last.evaluation)}); ` +
          `backing off ${retryDelayMs}ms and retrying.`,
        true,
      );
      await sleep(retryDelayMs);
    }
  }

  // Out of attempts with a graded result: assert on the last evaluation so the failure reports
  // real scores. (If every attempt threw a retryable error, the throw above already surfaced it.)
  const evaluation = last!.evaluation;
  expect(evaluation.accuracy).toBeGreaterThanOrEqual(4);
  expect(evaluation.completeness).toBeGreaterThanOrEqual(4);
  expect(evaluation.relevance).toBeGreaterThanOrEqual(4);
  expect(evaluation.clarity).toBeGreaterThanOrEqual(4);
  expect(evaluation.reasoning).toBeGreaterThanOrEqual(4);

  return { agentResult: last!.agentResult };
}

async function gradeOnce({
  mcpServer,
  model,
  prompt,
}: Omit<GradeInput, 'attempts'>): Promise<Attempt> {
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

      return { evaluation: evaluationResult.data, agentResult: evals };
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
