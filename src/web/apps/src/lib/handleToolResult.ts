import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  isDeleteDatasourceConfirmResult,
  renderDeleteDatasourceConfirm,
} from './deleteDatasourceConfirmClient.js';
import {
  isDeleteExtractRefreshTaskConfirmResult,
  renderDeleteExtractRefreshTaskConfirm,
} from './deleteExtractRefreshTaskConfirmClient.js';
import {
  isDeleteWorkbookConfirmResult,
  renderDeleteWorkbookConfirm,
} from './deleteWorkbookConfirmClient.js';
import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';
import { showError } from './showError.js';
import {
  isUpdateCloudExtractRefreshTaskConfirmResult,
  renderUpdateCloudExtractRefreshTaskConfirm,
} from './updateCloudExtractRefreshTaskConfirmClient.js';

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
 * Handles the tool result from the MCP app and embeds the Tableau viz
 * @param app - The MCP App instance
 * @param result - The tool result containing the view URL
 */
export async function handleToolResult(app: App, result: CallToolResult): Promise<void> {
  if (!result || result.isError) {
    showError('TOOL_ERROR');
    return;
  }

  // MCP-Apps HITL (flag ON): a delete/update preview returns a confirm-panel payload, not a viz URL.
  // Branch on the result shape and render the in-iframe HITL confirm panel; otherwise fall through to
  // viz embedding.
  if (isDeleteWorkbookConfirmResult(result)) {
    renderDeleteWorkbookConfirm(app, result);
    return;
  }
  if (isDeleteDatasourceConfirmResult(result)) {
    renderDeleteDatasourceConfirm(app, result);
    return;
  }
  if (isDeleteExtractRefreshTaskConfirmResult(result)) {
    renderDeleteExtractRefreshTaskConfirm(app, result);
    return;
  }
  if (isUpdateCloudExtractRefreshTaskConfirmResult(result)) {
    renderUpdateCloudExtractRefreshTaskConfirm(app, result);
    return;
  }

  // Parse failure
  let viewUrl: string;
  try {
    viewUrl = extractUrlObjectFromResult(result);
  } catch (e) {
    showError('PARSE_ERROR', e);
    return;
  }

  // Embedding API load failure
  try {
    await loadTableauEmbeddingApi(viewUrl);
  } catch (e) {
    showError('EMBED_LOAD_ERROR', e);
    return;
  }

  // Auth failure (minting)
  let token: string;
  try {
    token = await callGetEmbedTokenTool(app);
  } catch (e) {
    showError('AUTH_ERROR', e);
    return;
  }

  // Auth failure (runtime) - handled by onError callback
  embedTableauViz(viewUrl, token, () => showError('AUTH_ERROR'));

  const main = document.querySelector('.main');
  if (main) {
    setupOpenInTableauLink(app, viewUrl, main as HTMLElement);
  }
}
