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
  // Set the element's height to the viz's natural sheet height so it renders
  // fully; the ext-apps SDK's built-in auto-resize then grows the app frame to
  // match the resulting document height.
  viz.addEventListener('firstvizsizeknown', (event) => {
    const vizSize = (event as CustomEvent).detail?.vizSize;
    const sheetHeight = vizSize?.sheetSize?.maxSize?.height;
    if (typeof sheetHeight !== 'number') {
      return;
    }

    viz.style.height = `${sheetHeight}px`;
  });

  container.replaceChildren(viz);
}
