import type { App } from '@modelcontextprotocol/ext-apps';

import { recordEvent } from '../shared/recordEventClient.js';
import { getOrCreateOverlayGroup } from './overlayGroup.js';

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
 * Sets up the "Open in Tableau" link element for host-mediated link opening.
 * Creates the link element dynamically and appends it to the provided container.
 *
 * @param app - MCP App instance with openLink capability
 * @param url - URL to open when the link is clicked (empty URL means no link created)
 * @param container - Container element to append the link to
 */
export function setupOpenInTableauLink(app: App, url: string, container: HTMLElement): void {
  // Remove any existing link first (idempotency guard)
  const existingLink = container.querySelector('#openInTableauLink');
  if (existingLink) {
    existingLink.remove();
  }

  // Don't create link if URL is empty or host lacks openLinks capability
  const capabilities = app.getHostCapabilities();
  if (!url || !capabilities?.openLinks) {
    return;
  }

  // Create the link element with icon + label
  const link = document.createElement('a');
  link.id = 'openInTableauLink';
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

  // Set onclick handler to use host-mediated link opening
  link.onclick = async (e) => {
    e.preventDefault();
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
  };

  // Append to the shared overlay pill as the left-hand (first) control. handleToolResult
  // calls this before setupFullscreenButton, so the link lands left of the fullscreen
  // button. Falls back to the container when the pill's host (#vizStage) is missing.
  const overlayGroup = getOrCreateOverlayGroup(container);
  (overlayGroup ?? container).appendChild(link);
}
