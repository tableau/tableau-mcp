/**
 * @file Tableau Embedding utilities
 */
import { TABLEAU_VIZ_CONTAINER_ID } from '../shared/vizContainer.js';

export { TABLEAU_VIZ_CONTAINER_ID };

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
 * @param onError - Optional callback to handle viz load errors
 */
export function embedTableauViz(vizUrl: string, token: string, onError?: () => void): void {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);

  if (!container) {
    console.error(
      `[mcp-app] container element with id "${TABLEAU_VIZ_CONTAINER_ID}" not found; cannot embed viz`,
    );
    return;
  }

  // Create and replace any existing viz element (idempotent)
  const viz = createTableauVizElement(vizUrl, token);

  // The Embedding API reports the viz's natural size via `firstvizsizeknown`.
  // Set the element's height to the viz's natural sheet height plus the API-provided
  // chromeHeight so it renders fully; the ext-apps SDK's built-in auto-resize then grows
  // the app frame to match the resulting document height.
  viz.addEventListener('firstvizsizeknown', (event) => {
    const vizSize = (event as CustomEvent).detail?.vizSize;
    const sheetHeight = vizSize?.sheetSize?.maxSize?.height;
    const chromeHeight = vizSize?.chromeHeight;

    // Only set height when sheetHeight is available; chromeHeight may be 0 or absent (no chrome)
    if (typeof sheetHeight !== 'number') {
      return;
    }

    // chromeHeight may be missing, undefined, or 0 when there's no chrome; treat as 0
    const effectiveChromeHeight = typeof chromeHeight === 'number' ? chromeHeight : 0;
    viz.style.height = `${sheetHeight + effectiveChromeHeight}px`;
  });

  // Listen for runtime viz-load errors from the Tableau Embedding API v3.
  // 'vizloaderror' is the assumed DOM event for TableauEventType.VizLoadError; the API is
  // loaded at runtime from the Tableau server, so this event name needs runtime confirmation.
  // If incorrect, runtime token rejection/expiry will not surface the error UI.
  viz.addEventListener('vizloaderror', (event) => {
    console.error('[mcp-app] tableau-viz reported a load error', event);
    onError?.();
  });

  container.replaceChildren(viz);
}
