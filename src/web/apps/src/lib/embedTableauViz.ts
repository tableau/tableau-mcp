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

  // // Optional: Set common embedding properties
  // viz.setAttribute('toolbar', 'bottom');
  // viz.setAttribute('hide-tabs', 'false');

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

  // Create and append the viz element
  const viz = createTableauVizElement(vizUrl, token);
  container.appendChild(viz);
}
