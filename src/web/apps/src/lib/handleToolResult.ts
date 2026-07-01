import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DISCONNECTED_SVG } from '../assets/disconnectedSvg.js';
import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';

const urlSchema = z.object({
  url: z.string().url(),
});

const callToolResultSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
    )
    .nonempty(),
  isError: z.boolean().optional(),
});

/**
 * Extracts the view URL from tool result content
 */
export function extractUrlObjectFromResult(result: CallToolResult): string {
  const validated = callToolResultSchema.parse(result);
  const content = validated.content[0];

  const data = JSON.parse(content.text);
  const { url } = urlSchema.parse(data);
  return url;
}

type Scenario = 'TOOL_ERROR' | 'PARSE_ERROR' | 'AUTH_ERROR' | 'EMBED_LOAD_ERROR';

const ERROR_HEADING = 'Unable to load this Tableau view';

const ERROR_UI: Record<Scenario, { detail: string; logCode: string }> = {
  TOOL_ERROR: {
    detail: 'The tool request was unsuccessful.',
    logCode: '[mcp-app:tool-error] Tool returned an error result',
  },
  PARSE_ERROR: {
    detail: 'The response was not in the expected format.',
    logCode: '[mcp-app:parse-error] Failed to parse tool result',
  },
  AUTH_ERROR: {
    detail: 'Authentication was unsuccessful.',
    logCode: '[mcp-app:auth-error] Failed to obtain or use embed token',
  },
  EMBED_LOAD_ERROR: {
    detail: 'The visualization failed to load.',
    logCode: '[mcp-app:embed-load-error] Tableau Embedding API failed to load',
  },
};

/**
 * Shows an error message in the tableau viz container
 * @param scenario - The error scenario to display
 * @param cause - Optional error that caused this scenario
 */
export function showError(scenario: Scenario, cause?: unknown): void {
  const container = document.getElementById('tableauVizContainer');
  if (!container) {
    return;
  }

  console.error(ERROR_UI[scenario].logCode, cause);

  const errorElement = document.createElement('div');
  errorElement.className = 'mcp-app-error';
  errorElement.setAttribute('role', 'alert');

  // Add disconnected illustration icon
  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'mcp-app-error-icon';
  iconWrapper.setAttribute('aria-hidden', 'true');
  // Safe to use innerHTML here: DISCONNECTED_SVG is a static, trusted, build-time constant (never user input)
  iconWrapper.innerHTML = DISCONNECTED_SVG;

  // Add error text block (heading + message)
  const textWrapper = document.createElement('div');
  textWrapper.className = 'mcp-app-error-text';

  const headingElement = document.createElement('h2');
  headingElement.className = 'mcp-app-error-heading';
  headingElement.textContent = ERROR_HEADING;

  const messageElement = document.createElement('p');
  messageElement.className = 'mcp-app-error-message';
  messageElement.textContent = ERROR_UI[scenario].detail;

  textWrapper.append(headingElement, messageElement);
  errorElement.append(iconWrapper, textWrapper);
  container.replaceChildren(errorElement);
}

/**
 * Handles the tool result from the MCP app and embeds the Tableau viz
 * @param app - The MCP App instance
 * @param result - The tool result containing the view URL
 */
export async function handleToolResult(app: App, result: CallToolResult): Promise<void> {
  // AC1: Tool execution failure
  if (!result || result.isError) {
    showError('TOOL_ERROR');
    return;
  }

  // AC2: Parse failure
  let viewUrl: string;
  try {
    viewUrl = extractUrlObjectFromResult(result);
  } catch (e) {
    showError('PARSE_ERROR', e);
    return;
  }

  // AC4: Embedding API load failure
  try {
    await loadTableauEmbeddingApi(viewUrl);
  } catch (e) {
    showError('EMBED_LOAD_ERROR', e);
    return;
  }

  // AC3: Auth failure (minting)
  let token: string;
  try {
    token = await callGetEmbedTokenTool(app);
  } catch (e) {
    showError('AUTH_ERROR', e);
    return;
  }

  // AC3: Auth failure (runtime) - handled by onError callback
  embedTableauViz(viewUrl, token, () => showError('AUTH_ERROR'));

  const main = document.querySelector('.main');
  if (main) {
    setupOpenInTableauLink(app, viewUrl, main as HTMLElement);
  }
}
