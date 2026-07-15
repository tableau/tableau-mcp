import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';
import { isPublishedWorkbookResult, renderPublishedWorkbookCard } from './publishedWorkbookCard.js';
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
 * Parses the first text content entry of a tool result into a plain JSON value. Throws if the
 * result shape is unexpected or the text is not valid JSON (callers turn that into PARSE_ERROR).
 */
function parseResultPayload(result: CallToolResult): unknown {
  const validated = callToolResultSchema.parse(result);
  return JSON.parse(validated.content[0].text);
}

/**
 * Extracts the view URL from tool result content
 */
export function extractUrlObjectFromResult(result: CallToolResult): string {
  const { url } = urlSchema.parse(parseResultPayload(result));
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

  // Parse the payload once so we can dispatch on the optional `appView` discriminator. The shared
  // bundle has no per-tool routing, so this is how we tell a published-workbook result apart from
  // the default embed-a-viz path.
  let payload: unknown;
  try {
    payload = parseResultPayload(result);
  } catch (e) {
    showError('PARSE_ERROR', e);
    return;
  }

  // create-and-publish-workbook: render a link card instead of embedding a viz. Requires a valid
  // `url`; if absent the guard fails and we fall through to the default path (which will surface a
  // PARSE_ERROR for a missing url — the correct "no clickable card" fallback).
  //
  // No in-feed dashboard preview: the published dashboard's charts are drawn by the model's inline
  // JS, which the host's nonce-based CSP refuses to run inside a sandboxed iframe (a srcdoc frame
  // inherits the embedder CSP). The interactive dashboard is shown pre-publish as a Claude artifact,
  // and this card's Open link renders the real charts on the Tableau site — so the card stands alone.
  if (isPublishedWorkbookResult(payload)) {
    renderPublishedWorkbookCard(app, payload);
    return;
  }

  // Default path: embed the Tableau viz at `url`.
  let viewUrl: string;
  try {
    const { url } = urlSchema.parse(payload);
    viewUrl = url;
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
