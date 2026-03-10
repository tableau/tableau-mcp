import { AIMessage } from 'langchain';
import { EvaluationResult, EvaluatorT } from 'langsmith/evaluation';
import { KVMap } from 'langsmith/schemas';
import z from 'zod';

import { getAgent, getModel, prompt } from './base';

export const evalInputSchema = z.object({
  question: z.string(),
});

export const evalOutputSchema = z.object({
  toolsUsed: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
    }),
  ),
});

export const evalReferenceSchema = z.object({
  expectedTools: z.array(z.string()),
  mustContain: z.array(z.string()),
  rubric: z.string(),
});

export type EvalInput = z.infer<typeof evalInputSchema>;
export type EvalOutput = z.infer<typeof evalOutputSchema>;
export type EvalReference = z.infer<typeof evalReferenceSchema>;

/** Checks that every expected tool was actually invoked */
export const toolSelectionGrader: EvaluatorT = async ({
  outputs,
  referenceOutputs,
}: {
  outputs: KVMap;
  referenceOutputs?: KVMap;
}): Promise<EvaluationResult> => {
  const { toolsUsed } = evalOutputSchema.parse(outputs);
  const { expectedTools } = evalReferenceSchema.parse(referenceOutputs ?? { expectedTools: [] });

  if (expectedTools.length === 0) {
    return { key: 'tool_selection', score: 1 };
  }

  const hits = expectedTools.filter((expectedTool) =>
    toolsUsed.some((actualTool) => actualTool.name === expectedTool),
  );

  const score = hits.length / expectedTools.length;

  return {
    key: 'tool_selection',
    score,
    comment: `Expected [${expectedTools.join(', ')}] - got [${toolsUsed.map((tool) => tool.name).join(', ')}]`,
  };
};

/** Checks that the output contains required substrings */
export const contentPresenceGrader: EvaluatorT = async ({
  outputs,
  referenceOutputs,
}: {
  outputs: KVMap;
  referenceOutputs?: KVMap;
}): Promise<EvaluationResult> => {
  const { toolsUsed } = evalOutputSchema.parse(outputs);
  const { mustContain } = evalReferenceSchema.parse(referenceOutputs ?? { mustContain: [] });

  if (mustContain.length === 0) {
    return { key: 'content_presence', score: 1 };
  }

  const hits = toolsUsed.filter((tool) =>
    mustContain.some((s) => tool.content.toLowerCase().includes(s.toLowerCase())),
  );
  const score = hits.length / mustContain.length;

  return {
    key: 'content_presence',
    score,
    comment: `Found ${hits.length}/${mustContain.length} required terms`,
  };
};

/** LLM-as-judge for open-ended rubric grading */
export const rubricGrader: EvaluatorT = async ({
  inputs,
  outputs,
  referenceOutputs,
}: {
  inputs: KVMap;
  outputs: KVMap;
  referenceOutputs?: KVMap;
}): Promise<EvaluationResult> => {
  const { question } = evalInputSchema.parse(inputs);
  const { toolsUsed } = evalOutputSchema.parse(outputs);
  const { rubric } = evalReferenceSchema.parse(referenceOutputs ?? { rubric: '' });

  if (!rubric) {
    return { key: 'rubric', score: 1 };
  }

  const judgePrompt = `You are evaluating an AI agent's response to a user question.

Question: ${question}
Agent Response: ${toolsUsed.map((tool) => tool.content).join('\n') || 'none'}
Tools Used: ${toolsUsed.map((tool) => tool.name).join(', ') || 'none'}

Rubric: ${rubric}

Score the response from 0.0 to 1.0.
Respond ONLY with JSON: {"score": <number>, "comment": "<brief reason>"}`;

  const { agent } = await getAgent({
    model: getModel(),
  });

  const messages = await prompt(agent, judgePrompt);

  const text =
    messages.find<AIMessage>((message) => AIMessage.isInstance(message))?.content?.toString() ?? '';

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      key: 'rubric',
      score: parsed.score,
      comment: parsed.comment,
    };
  } catch {
    return { key: 'rubric', score: 0, comment: 'Judge failed to parse' };
  }
};
