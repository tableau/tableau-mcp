import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

import OPEN_ARROW_SVG from '../shared/assets/open-arrow.svg?raw';
import TABLEAU_LOGO_SVG from '../shared/assets/tableau-logo-color.svg?raw';
import { TABLEAU_VIZ_CONTAINER_ID } from '../shared/vizContainer.js';

// A small inline checkmark for the "Published" badge. Static, build-time constant — never user
// input — so it is safe to assign via innerHTML (same rule as showError's disconnected.svg).
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">' +
  '<path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The publish tool returns a flat CreateAndPublishResult; the client reads only these fields. `url`
// is optional (a publish with no webpageUrl still renders a non-clickable card). `location` names
// the destination — 'personalSpace' → "Personal Space", else `projectName`; it is optional for
// backward compatibility (absent → project publish). See createAndPublishWorkbook.ts.
const publishedWorkbookSchema = z.object({
  appView: z.literal('published-workbook-card'),
  name: z.string(),
  id: z.string().optional(),
  url: z.string().url().optional(),
  location: z.enum(['project', 'personalSpace']).optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  // Non-fatal builder advisories carried over from validation (e.g. "that .parquet asset may 404").
  // Rendered below the card so the user sees them without them blocking the published link. Never a
  // storage path — only human-readable advisories. Absent/empty → no warnings section.
  warnings: z.array(z.string()).optional(),
});

export type PublishedWorkbookResult = z.infer<typeof publishedWorkbookSchema>;

/**
 * Type guard: is this parsed tool payload a published-workbook card result we can render?
 * Only `appView` and `name` are required; `url` is optional — a successful publish with no
 * `webpageUrl` still renders a card (name/id/project), just without a clickable link.
 */
export function isPublishedWorkbookResult(value: unknown): value is PublishedWorkbookResult {
  return publishedWorkbookSchema.safeParse(value).success;
}

/**
 * Renders the published-workbook result card into the app container.
 *
 * When `url` is present the whole card is one clickable link to it. When the host supports it we
 * open via the host-mediated `app.openLink` (the host owns the new tab); otherwise the plain anchor
 * `href` navigation is the fallback. When `url` is absent (a successful publish with no
 * `webpageUrl`), the card renders as a plain, non-interactive container — still naming the workbook
 * and, if known, its id — rather than a link that would 404. All user-derived text (workbook name)
 * is set with `textContent`; the only raw-HTML insertions are the static Tableau-logo/arrow/check
 * SVG constants — never user input.
 *
 * @param app - The MCP App instance (for host-mediated link opening)
 * @param data - The validated published-workbook result
 */
export function renderPublishedWorkbookCard(app: App, data: PublishedWorkbookResult): void {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);
  if (!container) {
    return;
  }

  const hasUrl = Boolean(data.url);
  const card = document.createElement(hasUrl ? 'a' : 'div');
  card.className = 'pub-card';

  if (hasUrl) {
    const url = data.url as string;
    card.setAttribute('href', url);
    card.setAttribute('target', '_blank');
    card.setAttribute('rel', 'noopener noreferrer');
    card.setAttribute('aria-label', `Open published workbook ${data.name} in Tableau`);

    // Host-mediated open when the capability is present; otherwise leave the anchor to navigate.
    const capabilities = app.getHostCapabilities();
    if (capabilities?.openLinks) {
      card.onclick = async (e) => {
        e.preventDefault();
        try {
          await app.openLink({ url });
        } catch (error) {
          // The anchor href remains as a fallback; just note the host rejection.
          console.warn('[mcp-app] Open published workbook link request failed', {
            url,
            error,
          });
        }
      };
    }
  } else {
    card.setAttribute('aria-label', `Published workbook ${data.name}`);
  }

  // Left: Tableau color-logo tile (static SVG constant).
  const logo = document.createElement('div');
  logo.className = 'pub-card-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.insertAdjacentHTML('afterbegin', TABLEAU_LOGO_SVG);

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
  project.textContent =
    data.location === 'personalSpace'
      ? 'Personal Space'
      : (data.projectName ?? (data.projectId ? 'Project' : 'Default project'));

  meta.append(badge, dot, project);
  body.append(title, meta);

  // Right: "Open in Tableau ↗" affordance (static arrow SVG) when there is a link to open. When
  // there is no `url`, show the workbook id instead (if known) so the card still gives the user
  // something useful to reference — never a broken/dead "Open" affordance.
  let trailing: HTMLElement | undefined;
  if (hasUrl) {
    trailing = document.createElement('span');
    trailing.className = 'pub-card-open';
    const openText = document.createElement('span');
    openText.textContent = 'Open in Tableau';
    const arrow = document.createElement('span');
    arrow.className = 'pub-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = OPEN_ARROW_SVG;
    trailing.append(openText, arrow);
  } else if (data.id) {
    trailing = document.createElement('span');
    trailing.className = 'pub-card-id';
    trailing.textContent = `ID: ${data.id}`;
  }

  card.append(logo, body, ...(trailing ? [trailing] : []));

  // Non-fatal warnings render as a sibling BELOW the card (not inside the clickable anchor) so the
  // published link stays a single, clean click target. Each warning is set via textContent — never
  // innerHTML — so a warning string can never inject markup.
  const warnings = (data.warnings ?? []).filter((w) => w.trim().length > 0);
  if (warnings.length === 0) {
    container.replaceChildren(card);
    return;
  }

  const warningsEl = document.createElement('div');
  warningsEl.className = 'pub-card-warnings';
  warningsEl.setAttribute('role', 'status');
  for (const warning of warnings) {
    const item = document.createElement('div');
    item.className = 'pub-card-warning';
    item.textContent = warning;
    warningsEl.append(item);
  }
  container.replaceChildren(card, warningsEl);
}
