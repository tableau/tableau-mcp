import { Workbook } from '../../../sdks/tableau/types/workbook.js';

/**
 * Constructs a web URL for a Tableau view
 *
 * @param server - The Tableau server URL (e.g., 'https://my-server.com')
 * @param siteName - The site name (e.g., 'my-site'), or empty string/'Default' for default site
 * @param contentUrl - The view's contentUrl from the API (e.g., 'workbook/sheets/Sheet1')
 * @returns The full web URL to access the view in Tableau
 */
export function constructViewWebUrl(server: string, siteName: string, contentUrl: string): string {
  // Remove '/sheets/' from contentUrl if present
  // API returns 'workbook/sheets/Sheet1', URL uses 'workbook/Sheet1'
  const urlPath = contentUrl.replace(/\/sheets\//g, '/');

  const url = new URL(server);

  // Default site uses a different URL structure without /site/{siteName}
  if (!siteName || siteName === 'Default') {
    url.hash = `#/views/${urlPath}`;
  } else {
    url.hash = `#/site/${siteName}/views/${urlPath}`;
  }

  return url.toString();
}

export function getDefaultViewWebUrl(
  workbook: Workbook,
  server: string,
  siteName: string,
): string | undefined {
  const views = workbook.views?.view;
  if (!views || views.length === 0) {
    return undefined;
  }

  // Try to find the default view first
  let targetView = workbook.defaultViewId
    ? views.find((view) => view.id === workbook.defaultViewId)
    : undefined;

  // If default view was filtered out, fall back to the first view
  if (!targetView) {
    targetView = views[0];
  }

  if (!targetView?.contentUrl) {
    return undefined;
  }

  return constructViewWebUrl(server, siteName, targetView.contentUrl);
}
