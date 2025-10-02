import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';

import { getAgentWithTools, log } from './base.js';

export async function runEvals({
  mcpServer,
  model,
  prompt,
}: {
  mcpServer: MCPServerStdio;
  model: string;
  prompt: string;
}): Promise<Promise<StreamedRunResult<any, any>>> {
  log(`Evaluating prompt: ${prompt}`, true);

  const agent = await getAgentWithTools({
    mcpServer,
    model,
    systemPrompt:
      "You are an assistant responsible for evaluating the results of calling various tools. Given the user's query, use the tools available to you to answer the question.",
  });

  const result = await withTrace('run_agent', async () => {
    const stream = await run(agent, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await stream.completed;
    return stream;
  });

  return result;
}
