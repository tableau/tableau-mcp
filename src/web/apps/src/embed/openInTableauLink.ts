import type { App } from '@modelcontextprotocol/ext-apps';

import { recordEvent } from '../shared/recordEventClient.js';
import { getOrCreateOverlayGroup } from './overlayGroup.js';

const OPEN_IN_TABLEAU_LINK_ID = 'openInTableauLink';

/**
 * Shows an inline error message when the link fails to open.
 *
 * @param container - Container element to append the error message to
 */
function showOpenLinkError(container: HTMLElement): void {
  // Reuse the existing error message if present; the text is static so there's
  // no need to re-set it on repeated failures.
  if (container.querySelector('.open-in-tableau-error')) {
    return;
  }

  const errorMessage = document.createElement('div');
  errorMessage.className = 'open-in-tableau-error';
  errorMessage.textContent = 'The URL was unable to be opened.';
  container.appendChild(errorMessage);
}

/**
 * Removes any inline error message left over from a previous failed open.
 *
 * @param container - Container element to remove the error message from
 */
function clearOpenLinkError(container: HTMLElement): void {
  container.querySelector('.open-in-tableau-error')?.remove();
}

/**
 * Handles a click on the "Open in Tableau" link. Link opening is host-mediated, so this
 * routes through {@link App.openLink} and surfaces an inline error when the host denies
 * the request or it throws — clearing any leftover error once a later attempt succeeds.
 *
 * @param app - MCP App instance with openLink capability
 * @param url - URL to open
 * @param container - Container the inline error message is rendered into
 * @param event - The originating click event (its default navigation is suppressed)
 */
async function handleOpenLinkClick(
  app: App,
  url: string,
  container: HTMLElement,
  event: MouseEvent,
): Promise<void> {
  event.preventDefault();
  // Record the click immediately and unconditionally — the event captures the user's
  // click action, not the request's outcome, so it must fire before the (awaited,
  // possibly-throwing) openLink call rather than depending on it resolving.
  recordEvent(app, 'OPEN_IN_TABLEAU_CLICKED', url);
  try {
    const result = await app.openLink({ url });
    if (result.isError) {
      console.warn('Open in Tableau link request denied by host', { url });
      showOpenLinkError(container);
    } else {
      // Clear any error left over from a previous failed attempt.
      clearOpenLinkError(container);
    }
  } catch (error) {
    console.warn('Open in Tableau link request failed', { url, error });
    showOpenLinkError(container);
  }
}

/**
 * Builds the "Open in Tableau" link element: an `.overlay-control` anchor holding the
 * label (leading) and the external-link icon. This builder assembles the static
 * structure only — the click behavior is wired by {@link setupOpenInTableauLink} — so
 * it mirrors the builder/setup split used by the sibling fullscreen button.
 *
 * @param url - URL the link points at (also opened via the host on click)
 * @returns The assembled anchor, not yet attached to the DOM.
 */
function createOpenInTableauLinkElement(url: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.id = OPEN_IN_TABLEAU_LINK_ID;
  link.className = 'overlay-control';
  link.setAttribute('href', url);
  link.setAttribute('rel', 'noopener noreferrer');
  link.setAttribute('aria-label', 'Open in Tableau (opens in a new browser tab)');

  // Create label span
  const label = document.createElement('span');
  label.textContent = 'Open in Tableau';

  // Create icon (inline SVG using the symbol)
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'viz-control-icon');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#external-icon');
  icon.appendChild(use);

  // Assemble link: label + icon (left to right)
  link.appendChild(label);
  link.appendChild(icon);

  return link;
}

/**
 * Sets up the "Open in Tableau" link element for host-mediated link opening.
 * Creates the link element dynamically and appends it to the provided container.
 *
 * @param app - MCP App instance with openLink capability
 * @param url - URL to open when the link is clicked (empty URL means no link created)
 * @param container - Container element to append the link to
 */
export function setupOpenInTableauLink(app: App, url: string, container: HTMLElement): void {
  // Remove any existing link first (idempotency guard).
  container.querySelector(`#${OPEN_IN_TABLEAU_LINK_ID}`)?.remove();

  // Don't create the link if URL is empty or the host lacks openLinks capability.
  const capabilities = app.getHostCapabilities();
  if (!url || !capabilities?.openLinks) {
    return;
  }

  const link = createOpenInTableauLinkElement(url);

  // Route clicks through the host (host-mediated link opening).
  link.onclick = (e) => void handleOpenLinkClick(app, url, container, e);

  // Append to the shared overlay pill as the left-hand (first) control. handleToolResult
  // calls this before setupFullscreenButton, so the link lands left of the fullscreen
  // button. Falls back to the container when the pill's host (#vizStage) is missing.
  const overlayGroup = getOrCreateOverlayGroup(container);
  (overlayGroup ?? container).appendChild(link);
}
