import { getConfig } from '../config.js';
import { WebMcpServer } from '../server.web.js';
import { getJobOptimizationInformPrompt } from './jobOptimization/inform.js';
import { WebPromptFactory } from './registry.js';
import { getStaleContentCleanupInformPrompt } from './staleContent/inform.js';

const webPromptFactories: ReadonlyArray<WebPromptFactory> = [
  getStaleContentCleanupInformPrompt,
  getJobOptimizationInformPrompt,
];

export const registerPrompts = (server: WebMcpServer): void => {
  const config = getConfig();
  for (const factory of webPromptFactories) {
    const prompt = factory(server);
    if (prompt.disabled(config)) {
      continue;
    }
    server.mcpServer.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      // The MCP SDK's PromptCallback type discriminates on whether argsSchema is provided.
      // Our registration always provides one for argument-bearing prompts; cast through any
      // to satisfy the SDK's overload without fragmenting the registration shape.

      prompt.callback as any,
    );
  }
};
