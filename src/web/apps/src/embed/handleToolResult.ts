import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { extractToolErrorMessage } from '../../../../utils/extractToolErrorMessage.js';
import { showError } from '../shared/showError.js';
import { embedTableauViz } from './embedTableauViz.js';
import { setupFullscreenButton } from './fullscreenButton.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';

const callToolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).nonempty(),
});

const urlSchema = z.object({
  url: z.string().url(),
});

/**
 * Extracts the view URL from a tool-result payload, or returns undefined when the payload isn't
 * a well-formed viz result. We still validate the expected shape with Zod, but fail silently
 * rather than throwing: the host re-fires `tool-result` on every re-render/re-mount, and those
 * deliveries are frequently empty, non-viz, or url-less. Those are not errors — just "nothing to
 * render" — so the caller no-ops instead of surfacing an error.
 */
export function extractViewUrl(result: CallToolResult): string | undefined {
  try {
    const { content } = callToolResultSchema.parse(result);
    const data = JSON.parse(content[0].text);
    return urlSchema.parse(data).url;
  } catch {
    // Any failure — wrong result shape, unparseable text, or a missing/invalid url — means there
    // is no viz to render. Return undefined so the caller silently no-ops. We must NOT rethrow or
    // surface an error here: the host re-fires tool-result on every re-render/re-mount, so raising
    // an error on these url-less deliveries would flood telemetry and could clobber a good render.
    return undefined;
  }
}

/**
 * Handles a tool result from an embed-Tableau-viz tool (get-view / get-workbook) and embeds the viz.
 * @param app - The MCP App instance
 * @param result - The tool result containing the view URL
 */
export async function handleToolResult(app: App, result: CallToolResult): Promise<void> {
  if (!result || result.isError) {
    const cause = result ? extractToolErrorMessage(result) : undefined;
    showError('TOOL_ERROR', cause, app);
    return;
  }

  // No usable view URL: empty re-delivery, a non-viz result, or an unparseable payload. The host
  // re-fires tool-result on re-render/re-mount, so treating these as errors floods telemetry and
  // can clobber a good render. Silently no-op and keep whatever is currently displayed.
  const viewUrl = extractViewUrl(result);
  if (!viewUrl) {
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

  const main = document.querySelector('.main');
  if (main) {
    setupOpenInTableauLink(app, viewUrl, main as HTMLElement);
    setupFullscreenButton(app, main as HTMLElement);
  }

  // Auth failure (runtime) - handled by onError callback
  embedTableauViz(viewUrl, token, () => showError('AUTH_ERROR', undefined, app));
}
