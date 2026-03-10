import { ToolMessage } from 'langchain';

import { getDefaultEnv } from '../testEnv';
import { getAgent, getMcpServer, getModel, prompt } from './base';
import { EvalInput, EvalOutput } from './evaluators';

export async function target(inputs: EvalInput): Promise<EvalOutput> {
  const env = getDefaultEnv();

  const { agent, client } = await getAgent({
    model: getModel(),
    mcpServer: getMcpServer(env),
  });

  try {
    const messages = await prompt(agent, inputs.question);

    const toolsUsed = messages.reduce<EvalOutput['toolsUsed']>((acc, message) => {
      if (ToolMessage.isInstance(message)) {
        acc.push({
          name: message.name ?? 'unknown tool',
          content: message.content.toString(),
        });
      }
      return acc;
    }, []);

    return { toolsUsed };
  } finally {
    await client?.close();
  }
}
