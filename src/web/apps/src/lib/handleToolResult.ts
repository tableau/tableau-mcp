import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';
import { isPublishedWorkbookResult, renderPublishedWorkbookCard } from './publishedWorkbookCard.js';
import { renderDashboardPreview } from './renderDashboardPreview.js';
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
 * @param dashboardHtml - The built dashboard HTML captured from the tool *input* (create-and-publish
 *   -workbook only). When present alongside a published-workbook result, we render a live preview of
 *   it above the card so the user sees exactly what was published — without the HTML ever entering
 *   the tool result (and thus the model's context). Undefined for every other tool.
 */
export async function handleToolResult(
  app: App,
  result: CallToolResult,
  dashboardHtml?: string,
): Promise<void> {
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
  if (isPublishedWorkbookResult(payload)) {
    // Card first (it uses replaceChildren), then prepend the dashboard preview above it so the user
    // sees what was published. The preview is best-effort: if the HTML wasn't captured or the render
    // fails, the card alone still stands.
    renderPublishedWorkbookCard(app, payload);
    if (dashboardHtml) {
      try {
        renderDashboardPreview(dashboardHtml);
      } catch (e) {
        // A failed preview must never take down the (working) card.
        console.error('[mcp-app] Failed to render dashboard preview', e);
      }
    }
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
