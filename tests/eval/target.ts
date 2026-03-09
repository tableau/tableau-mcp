import { getAgent, getMcpServer, getModel } from './base';
import { EvalInput, EvalOutput } from './evaluators';

export async function target(inputs: EvalInput): Promise<EvalOutput> {
  const agent = await getAgent({
    model: getModel(),
    mcpServer: getMcpServer(),
  });

  const result = await agent.invoke({
    messages: [{ role: 'user', content: inputs.question }],
  });

  const messages = result.messages as Array<{ role: string; content: string; name?: string }>;
  const lastMessage = messages.at(-1);
  const output =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  // Collect tool names used during the run
  const toolsUsed = messages
    .filter((m) => m.role === 'tool' && m.name)
    .map((m) => m.name as string);

  return { output, toolsUsed };
}
