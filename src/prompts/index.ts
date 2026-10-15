import { type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Config, getConfig } from '../config.js';
import { WebMcpServer } from '../server.web.js';
import { getExtractOptimizationApplyPrompt } from './extractOptimization/apply.js';
import { getJobOptimizationInformPrompt } from './jobOptimization/inform.js';
import { WebPromptFactory, WebPromptRegistration } from './registry.js';
import { getStaleContentCleanupApplyPrompt } from './staleContent/apply.js';
import { getStaleContentCleanupInformPrompt } from './staleContent/inform.js';
import { getUserLicenseReclamationApplyPrompt } from './userLicenseReclamation/apply.js';
import { getUserLicenseReclamationInformPrompt } from './userLicenseReclamation/inform.js';

const webPromptFactories: ReadonlyArray<WebPromptFactory> = [
  getStaleContentCleanupInformPrompt,
  getStaleContentCleanupApplyPrompt,
  getJobOptimizationInformPrompt,
  getExtractOptimizationApplyPrompt,
  getUserLicenseReclamationInformPrompt,
  getUserLicenseReclamationApplyPrompt,
];

/**
 * URI prefix under which every enabled admin prompt's workflow is also served as an MCP resource.
 * MCP prompts are user-invoked only (e.g. a Claude Code slash command) — the model cannot call
 * prompts/get — but clients such as Claude Code let the model list and read resources itself, so
 * the resource is how the model reaches a workflow on its own (W-23757369).
 */
export const ADMIN_WORKFLOW_RESOURCE_URI_PREFIX = 'tableau-mcp://admin-workflows/';

export const getAdminWorkflowResourceUri = (promptName: string): string =>
  `${ADMIN_WORKFLOW_RESOURCE_URI_PREFIX}${promptName}`;

// Guards against double-registration on a shared McpServer: registerPrompt and registerResource
// both throw on a duplicate name/URI. Same pattern as src/skills/index.ts. HTTP mode builds a fresh
// McpServer per request, so this never suppresses registration across requests.
const registeredServer = new WeakSet<object>();

/**
 * Builds every web prompt registration and drops those whose `disabled(config)` predicate is true.
 *
 * Single source of truth for "which admin workflows are live": the MCP prompts and their
 * workflow resources are both registered from this list, so the two surfaces can never disagree.
 */
export const getEnabledWebPrompts = async (
  server: WebMcpServer,
  config: Config = getConfig(),
): Promise<Array<WebPromptRegistration>> => {
  const enabled: Array<WebPromptRegistration> = [];
  for (const factory of webPromptFactories) {
    const prompt = factory(server);
    if (await prompt.disabled(config)) {
      continue;
    }
    enabled.push(prompt);
  }
  return enabled;
};

/**
 * Renders a prompt's workflow with default arguments as the text the prompt itself returns:
 * the text parts of its messages, joined. The workflow text therefore lives only in src/prompts.
 */
export const renderPromptWorkflowText = async (prompt: WebPromptRegistration): Promise<string> => {
  // Parse an empty object so any schema-level defaults apply exactly as prompts/get would.
  const args = prompt.argsSchema ? z.object(prompt.argsSchema).parse({}) : {};
  const result = await prompt.callback(args as Parameters<typeof prompt.callback>[0]);
  return result.messages
    .flatMap(({ content }) => (content.type === 'text' ? [content.text] : []))
    .join('\n\n');
};

export const registerPrompts = async (server: WebMcpServer): Promise<void> => {
  const mcp = server.mcpServer;
  if (registeredServer.has(mcp)) {
    return;
  }
  registeredServer.add(mcp);

  for (const prompt of await getEnabledWebPrompts(server)) {
    mcp.registerPrompt(
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

    // Static default-argument resource only. The SDK's (v1.29) RFC 6570 `{?a,b}` matching only
    // matches when every query param is present in declared order, so argument-bearing resource
    // templates are not reliable. Non-default scope is still reachable: the model can adjust the tool
    // arguments the workflow spells out, or the user can run the prompt with arguments.
    // Rendered at read time (not registration) so date-relative text stays current.
    const uri = getAdminWorkflowResourceUri(prompt.name);
    mcp.registerResource(
      prompt.name,
      uri,
      { title: prompt.title, description: prompt.description, mimeType: 'text/markdown' },
      async (): Promise<ReadResourceResult> => ({
        contents: [
          { uri, mimeType: 'text/markdown', text: await renderPromptWorkflowText(prompt) },
        ],
      }),
    );
  }
};
