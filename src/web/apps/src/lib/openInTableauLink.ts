import type { App } from '@modelcontextprotocol/ext-apps';

/**
 * Sets up the "Open in Tableau" link element for host-mediated link opening.
 *
 * @param app - MCP App instance with openLink capability
 * @param url - URL to open when the link is clicked (empty URL keeps link hidden)
 */
export function setupOpenInTableauLink(app: App, url: string): void {
  const link = document.getElementById('openInTableauLink') as HTMLAnchorElement | null;

  if (!link) {
    return;
  }

  // Keep link hidden if URL is empty or host lacks openLinks capability
  const capabilities = app.getHostCapabilities();
  if (!url || !capabilities?.openLinks) {
    link.hidden = true;
    return;
  }

  // Reveal link and set href (for accessibility/hover)
  link.hidden = false;
  link.setAttribute('href', url);

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
}
