import type { App } from '@modelcontextprotocol/ext-apps';

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

  // Create the link element
  const link = document.createElement('a');
  link.id = 'openInTableauLink';
  link.className = 'open-in-tableau';
  link.setAttribute('href', url);
  link.setAttribute('rel', 'noopener noreferrer');
  link.setAttribute('aria-label', 'Open in Tableau (opens in a new browser tab)');
  link.textContent = 'Open in Tableau ↗';

  // Set onclick handler to use host-mediated link opening
  link.onclick = async (e) => {
    e.preventDefault();

    try {
      const result = await app.openLink({ url });

      if (result.isError) {
        console.warn('Open in Tableau link request denied by host', { url });
      }
    } catch (error) {
      console.warn('Open in Tableau link request failed', { url, error });
    }
  };

  // Append to container
  container.appendChild(link);
}
