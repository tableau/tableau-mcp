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
 * @param onSizeKnown - Optional callback invoked once the viz reports its
 *   natural size, with the width/height the app frame should grow to. Wire
 *   this to `app.sendSizeChanged` so the host resizes the frame to fit the viz.
 */
export function embedTableauViz(
  vizUrl: string,
  token: string,
  onSizeKnown?: (size: { width?: number; height: number }) => void,
): void {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);

  if (!container) {
    throw new Error(`Container element with id "${TABLEAU_VIZ_CONTAINER_ID}" not found`);
  }

  // Create and replace any existing viz element (idempotent)
  const viz = createTableauVizElement(vizUrl, token);

  // The Embedding API reports the viz's natural size via `firstvizsizeknown`.
  // Set the element's height so it renders fully, then notify the host so it
  // can grow the app frame to match.
  viz.addEventListener('firstvizsizeknown', (event) => {
    const vizSize = (event as CustomEvent).detail?.vizSize;
    const sheetHeight = vizSize?.sheetSize?.maxSize?.height;
    if (typeof sheetHeight !== 'number') {
      return;
    }

    const chromeHeight = typeof vizSize.chromeHeight === 'number' ? vizSize.chromeHeight : 0;
    const totalHeight = sheetHeight + chromeHeight;

    viz.style.height = `${totalHeight}px`;
    onSizeKnown?.({ height: totalHeight });
  });

  container.replaceChildren(viz);
}
