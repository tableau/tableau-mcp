/**
 * @file Tableau Embedding utilities
 */

const TABLEAU_VIZ_CONTAINER_ID = 'tableauVizContainer';

/**
 * Chrome offset in pixels to account for the tableau-viz web component's
 * border and status bar that are not included in the reported sheet height
 * from the firstvizsizeknown event. This ensures the full viz (sheet + chrome)
 * is visible without clipping or scrollbars.
 *
 * Value derived from typical tableau-viz chrome: ~4px top border + ~24px status bar.
 */
const VIZ_CHROME_HEIGHT_PX = 28;

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

  // Hide the toolbar
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
  // Set the element's height to the viz's natural sheet height plus chrome offset
  // so it renders fully; the ext-apps SDK's built-in auto-resize then grows the
  // app frame to match the resulting document height.
  viz.addEventListener('firstvizsizeknown', (event) => {
    const vizSize = (event as CustomEvent).detail?.vizSize;
    const sheetHeight = vizSize?.sheetSize?.maxSize?.height;
    if (typeof sheetHeight !== 'number') {
      return;
    }

    viz.style.height = `${sheetHeight + VIZ_CHROME_HEIGHT_PX}px`;
  });

  container.replaceChildren(viz);
}
