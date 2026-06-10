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

  // Default site uses a different URL structure without /site/{siteName}
  if (!siteName || siteName === 'Default') {
    return `${server}/#/views/${urlPath}`;
  }

  return `${server}/#/site/${siteName}/views/${urlPath}`;
}
