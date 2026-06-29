/**
 * @file Tableau Embedding utilities
 */

const TABLEAU_VIZ_CONTAINER_ID = 'tableauVizContainer';

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

  // Hide the toolbar to prevent inner scrollbar (toolbar adds ~27-40px beyond reported sheet height)
  viz.setAttribute('toolbar', 'hidden');

  return viz;
}

/**
 * Embeds a Tableau visualization into the tableauVizContainer element
 * @param vizUrl - The URL of the Tableau view to embed
 * @param token - The OAuth Bearer token for authentication
 */
export function embedTableauViz(vizUrl: string, token: string): void {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);

  if (!container) {
    throw new Error(`Container element with id "${TABLEAU_VIZ_CONTAINER_ID}" not found`);
  }

  // Create and replace any existing viz element (idempotent)
  const viz = createTableauVizElement(vizUrl, token);

  // The Embedding API reports the viz's natural size via `firstvizsizeknown`.
  // Set the element's width/height ATTRIBUTES (not just CSS) so the Embedding
  // API sizes its internal cross-origin iframe correctly. Without attributes,
  // the iframe uses a default size and creates its own scrollbar.
  // Width is set to "100%" for responsive behavior; height is the native px value.
  viz.addEventListener('firstvizsizeknown', (event) => {
    const vizSize = (event as CustomEvent).detail?.vizSize;
    const sheetHeight = vizSize?.sheetSize?.maxSize?.height;
    if (typeof sheetHeight !== 'number') {
      return;
    }

    console.log('height: ', sheetHeight);

    // Set attributes for Embedding API iframe sizing
    viz.setAttribute('width', '100%');
    viz.setAttribute('height', String(sheetHeight));

    // Also set CSS height for backward compatibility
    viz.style.height = `${sheetHeight}px`;
  });

  container.replaceChildren(viz);
}
