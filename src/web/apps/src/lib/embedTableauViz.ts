/**
 * @file Tableau Embedding utilities
 */

/**
 * Creates and configures a Tableau viz element for embedding
 * @param vizUrl - The URL of the Tableau view to embed
 * @param token - The OAuth Bearer token for authentication
 * @returns The configured tableau-viz element
 */
export function createTableauVizElement(vizUrl: string, token: string): HTMLElement {
  // Create the tableau-viz custom element
  const viz = document.createElement('tableau-viz');

  // Set the source URL
  viz.setAttribute('src', vizUrl);

  // Set the token for authentication
  viz.setAttribute('token', token);

  // Optional: Set common embedding properties
  viz.setAttribute('toolbar', 'bottom');
  viz.setAttribute('hide-tabs', 'false');

  // Make it fill the container
  viz.style.width = '100%';
  viz.style.height = '100%';
  viz.style.display = 'block';

  return viz;
}

/**
 * Embeds a Tableau visualization into a container element
 * @param containerId - The ID of the container element
 * @param vizUrl - The URL of the Tableau view to embed
 * @param token - The OAuth Bearer token for authentication
 */
export function embedTableauViz(containerId: string, vizUrl: string, token: string): void {
  const container = document.getElementById(containerId);

  if (!container) {
    throw new Error(`Container element with id "${containerId}" not found`);
  }

  // Clear existing content safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Create and append the viz element
  const viz = createTableauVizElement(vizUrl, token);
  container.appendChild(viz);

  console.info('Tableau viz embedded successfully');
}

/**
 * Extracts the view URL from tool result content
 * @param result - The MCP tool result
 * @returns The view URL if found, otherwise null
 */
export function extractViewUrlFromResult(result: any): string | null {
  try {
    const content = result.content?.[0];
    if (content?.type === 'text') {
      const data = JSON.parse(content.text);

      // Check for various possible URL fields
      return data.viewUrl || data.contentUrl || data.webpageUrl || data.url || null;
    }
  } catch (error) {
    console.error('Failed to extract view URL from result:', error);
  }

  return null;
}
