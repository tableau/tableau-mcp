import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

import OPEN_ARROW_SVG from '../assets/open-arrow.svg?raw';
import SPARKLE_SVG from '../assets/tableau-sparkle.svg?raw';
import { TABLEAU_VIZ_CONTAINER_ID } from './embedTableauViz.js';

// A small inline checkmark for the "Published" badge. Static, build-time constant — never user
// input — so it is safe to assign via innerHTML (same rule as showError's disconnected.svg).
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">' +
  '<path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The publish tool returns a flat CreateAndPublishResult; the client reads only these fields. `url`
// is required and must be a real URL — when the server returns no webpageUrl the tool omits it, the
// guard fails, and handleToolResult falls back to plain JSON (better an absent card than a broken
// link). `projectName` is the human-readable destination project (e.g. "Default"); we render it in
// the meta row so the card names where the workbook landed. `projectId` (the LUID) is kept only as
// a presence signal for the fallback label. See createAndPublishWorkbook.ts / publishShared.ts.
const publishedWorkbookSchema = z.object({
  appView: z.literal('published-workbook-card'),
  name: z.string(),
  url: z.string().url(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});

export type PublishedWorkbookResult = z.infer<typeof publishedWorkbookSchema>;

/**
 * Type guard: is this parsed tool payload a published-workbook card result we can render?
 * Requires a valid `url`; a payload with `appView` but no usable URL returns false so the caller
 * falls back to the default (JSON / embed) path rather than rendering a link-less card.
 */
export function isPublishedWorkbookResult(value: unknown): value is PublishedWorkbookResult {
  return publishedWorkbookSchema.safeParse(value).success;
}

/**
 * Renders the published-workbook result card into the app container.
 *
 * The whole card is one clickable link to the workbook `url`. When the host supports it we open via
 * the host-mediated `app.openLink` (the host owns the new tab); otherwise the plain anchor `href`
 * navigation is the fallback. All user-derived text (workbook name) is set with `textContent`; the
 * only innerHTML is the static sparkle/arrow/check SVG constants — never user input.
 *
 * @param app - The MCP App instance (for host-mediated link opening)
 * @param data - The validated published-workbook result
 */
export function renderPublishedWorkbookCard(app: App, data: PublishedWorkbookResult): void {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);
  if (!container) {
    return;
  }

  const card = document.createElement('a');
  card.className = 'pub-card';
  card.setAttribute('href', data.url);
  card.setAttribute('target', '_blank');
  card.setAttribute('rel', 'noopener noreferrer');
  card.setAttribute('aria-label', `Open published workbook ${data.name} in Tableau`);

  // Host-mediated open when the capability is present; otherwise leave the anchor to navigate.
  const capabilities = app.getHostCapabilities();
  if (capabilities?.openLinks) {
    card.onclick = async (e) => {
      e.preventDefault();
      try {
        await app.openLink({ url: data.url });
      } catch (error) {
        // The anchor href remains as a fallback; just note the host rejection.
        console.warn('[mcp-app] Open published workbook link request failed', {
          url: data.url,
          error,
        });
      }
    };
  }

  // Left: sparkle tile (static SVG, safe innerHTML).
  const logo = document.createElement('div');
  logo.className = 'pub-card-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = SPARKLE_SVG;

  // Middle: workbook name + a "✓ Published · <project>" meta row.
  const body = document.createElement('div');
  body.className = 'pub-card-body';

  const title = document.createElement('div');
  title.className = 'pub-card-title';
  title.textContent = data.name;

  const meta = document.createElement('div');
  meta.className = 'pub-card-meta';

  const badge = document.createElement('span');
  badge.className = 'pub-card-badge';
  const check = document.createElement('span');
  check.className = 'pub-card-check';
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = CHECK_SVG;
  const badgeText = document.createElement('span');
  badgeText.textContent = 'Published';
  badge.append(check, badgeText);

  const dot = document.createElement('span');
  dot.className = 'pub-card-dot';
  dot.setAttribute('aria-hidden', 'true');

  const project = document.createElement('span');
  project.className = 'pub-card-project';
  // Name the actual destination when we have it (e.g. "Default"). Fall back to a generic label only
  // when projectName is absent: an omitted projectId means the site default project; a present LUID
  // with no name means an explicit project we couldn't name. See publishShared.ts.
  project.textContent = data.projectName ?? (data.projectId ? 'Project' : 'Default project');

  meta.append(badge, dot, project);
  body.append(title, meta);

  // Right: "Open ↗" affordance (static arrow SVG).
  const open = document.createElement('span');
  open.className = 'pub-card-open';
  const openText = document.createElement('span');
  openText.textContent = 'Open';
  const arrow = document.createElement('span');
  arrow.className = 'pub-card-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = OPEN_ARROW_SVG;
  open.append(openText, arrow);

  card.append(logo, body, open);
  container.replaceChildren(card);
}
