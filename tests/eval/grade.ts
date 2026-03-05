import { HumanMessage } from '@langchain/core/messages';
import { StdioConnection } from '@langchain/mcp-adapters';
import { createAgent } from 'langchain';

import { getAgent, log } from './base.js';
import { evaluationSchema } from './evaluationResult.js';

type GradeInput = {
  mcpServer: StdioConnection;
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
}: GradeInput): Promise<{ agentResult: Array<{ step: string; content: string }> }> {
  const evals = await promptAgent({ mcpServer, model, prompt });
  log('\n');

  console.log(evals);

  return { agentResult: evals };

  // const evalAgentPrompt = `
  //   Here is the user input: ${prompt}
  //   Here is the LLM's answer: ${evals.finalOutput}`;

  // const evalAgent = await getAgent({
  //   model,
  //   systemPrompt: evalSystemPrompt,
  // });

  // const result = await evalAgent.invoke({
  //   messages: [{ role: 'user', content: evalAgentPrompt }],
  // });

  // log('\n');

  // const jsonRegexes = [/(?<JSON>\{[^}]+\})/];
  // for (const jsonRegex of jsonRegexes) {
  //   const match = result.finalOutput?.match(jsonRegex);
  //   if (match) {
  //     const evaluationResult = evaluationSchema.safeParse(JSON.parse(match.groups?.JSON ?? '{}'));
  //     if (!evaluationResult.success) {
  //       throw new Error(
  //         `Could not parse agent output as an evaluation result:\n${result.finalOutput}`,
  //       );
  //     }

  //     const evaluation = evaluationResult.data;
  //     expect(evaluation.accuracy).toBeGreaterThanOrEqual(4);
  //     expect(evaluation.completeness).toBeGreaterThanOrEqual(4);
  //     expect(evaluation.relevance).toBeGreaterThanOrEqual(4);
  //     expect(evaluation.clarity).toBeGreaterThanOrEqual(4);
  //     expect(evaluation.reasoning).toBeGreaterThanOrEqual(4);

  //     return {
  //       agentResult: evals,
  //     };
  //   }
  // }
  // throw new Error('Could not parse JSON from agent output');
}

async function promptAgent({
  mcpServer,
  model,
  prompt,
}: GradeInput): Promise<Array<{ step: string; content: string }>> {
  log(`Evaluating prompt: ${prompt}`, true);

  const agentWithTools = await getAgent({
    mcpServer,
    model,
    systemPrompt: agentSystemPrompt,
  });

  // Use invoke() so the agent runs to completion and we get a result or a clear error.
  // stream() with streamMode: 'updates' only yields after each graph node completes;
  // the first chunk comes after the first node (usually the LLM call). If the LLM
  // request hangs, the stream never yields and the loop appears to stall.
  //const result = await agentWithTools.invoke(new HumanMessage(prompt));

  // Convert final state into the same shape as the previous stream-based path
  const chunks: Array<{ step: string; content: string }> = [];
  for await (const chunk of await agentWithTools.stream(
    { messages: [{ role: 'user', content: prompt }] },
    { streamMode: 'updates' },
  )) {
    const [step, content] = Object.entries(chunk)[0];
    log(`step: ${step}`);
    log(`content: ${content}`);
    chunks.push({ step, content });
  }

  return chunks;
}
