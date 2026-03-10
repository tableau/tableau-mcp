import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from 'langchain';

import { getDefaultEnv } from '../testEnv';
import { getAgent, getMcpServer, getModel } from './base';
import { EvalInput, EvalOutput } from './evaluators';

export async function target(inputs: EvalInput): Promise<EvalOutput> {
  const env = getDefaultEnv();

  const { agent, client } = await getAgent({
    model: getModel(),
    mcpServer: getMcpServer(env),
  });

  try {
    console.log(`Invoking agent with input: ${inputs.question}...`);
    const { messages } = (await agent.invoke({
      messages: [{ role: 'user', content: inputs.question }],
    })) as { messages: Array<AIMessage | HumanMessage | SystemMessage | ToolMessage> };

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
