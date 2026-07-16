import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';
import { showError } from './showError.js';

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

/**
 * Handles a tool result from an embed-Tableau-viz tool (get-view / get-workbook) and embeds the viz.
 * @param app - The MCP App instance
 * @param result - The tool result containing the view URL
 */
export async function handleToolResult(app: App, result: CallToolResult): Promise<void> {
  if (!result || result.isError) {
    showError('TOOL_ERROR', undefined, app);
    return;
  }

  // Parse failure
  let viewUrl: string;
  try {
    viewUrl = extractUrlObjectFromResult(result);
  } catch (e) {
    showError('PARSE_ERROR', e, app);
    return;
  }

  // Embedding API load failure
  try {
    await loadTableauEmbeddingApi(viewUrl);
  } catch (e) {
    showError('EMBED_LOAD_ERROR', e, app);
    return;
  }

  // Auth failure (minting)
  let token: string;
  try {
    token = await callGetEmbedTokenTool(app);
  } catch (e) {
    showError('AUTH_ERROR', e, app);
    return;
  }

  // Auth failure (runtime) - handled by onError callback
  embedTableauViz(viewUrl, token, () => showError('AUTH_ERROR', undefined, app));

  const main = document.querySelector('.main');
  if (main) {
    setupOpenInTableauLink(app, viewUrl, main as HTMLElement);
  }
}
