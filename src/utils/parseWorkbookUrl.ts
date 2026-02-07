/**
 * Tableau Workbook URL Parser
 * 
 * Parses various Tableau URL formats to extract workbook and view identifiers.
 * 
 * Supported URL formats:
 * - Hash-based: https://tableau.company.com/#/views/WorkbookName/ViewName
 * - Path-based: https://tableau.company.com/t/SiteName/views/WorkbookName/ViewName
 * - Embed: https://tableau.company.com/views/WorkbookName/ViewName?:embed=yes
 */

import { parseUrl } from './parseUrl.js';

export interface ParsedWorkbookUrl {
  /** The workbook content URL (workbook name/identifier in URL) */
  workbookContentUrl: string;
  /** The sheet/view content URL (optional, may be the default view) */
  sheetContentUrl?: string;
  /** The site name (for multi-site deployments) */
  siteName?: string;
  /** The full parsed URL */
  url: URL;
}

export interface WorkbookUrlParseError {
  type: 'invalid-url' | 'no-workbook-found';
  message: string;
}

/**
 * Parses a Tableau URL to extract workbook and view identifiers.
 * 
 * @param urlString - The full Tableau URL
 * @returns Parsed workbook info or an error
 * 
 * @example
 * // Hash-based URL
 * parseWorkbookUrl('https://tableau.company.com/#/views/Superstore/Overview')
 * // Returns: { workbookContentUrl: 'Superstore', sheetContentUrl: 'Overview', ... }
 * 
 * @example
 * // Path-based URL with site
 * parseWorkbookUrl('https://tableau.company.com/t/MySite/views/Superstore/Overview')
 * // Returns: { workbookContentUrl: 'Superstore', sheetContentUrl: 'Overview', siteName: 'MySite', ... }
 */
export function parseWorkbookUrl(
  urlString: string
): ParsedWorkbookUrl | WorkbookUrlParseError {
  const url = parseUrl(urlString);

  if (!url) {
    return {
      type: 'invalid-url',
      message: `Invalid URL: ${urlString}`,
    };
  }

  // Determine if URL uses hash-based or path-based routing
  // Hash-based: /#/views/WorkbookName/ViewName
  // Path-based: /t/SiteName/views/WorkbookName/ViewName or /views/WorkbookName/ViewName

  let pathParts: string[];

  if (url.hash && url.hash.includes('/views/')) {
    // Hash-based URL
    pathParts = url.hash.split('?')[0].split('/');
  } else if (url.pathname.includes('/views/')) {
    // Path-based URL
    pathParts = url.pathname.split('/');
  } else {
    return {
      type: 'no-workbook-found',
      message: 'Could not identify workbook in URL. Expected "/views/WorkbookName" pattern.',
    };
  }

  // Find the 'views' segment
  const viewsIndex = pathParts.indexOf('views');
  if (viewsIndex === -1) {
    return {
      type: 'no-workbook-found',
      message: 'Could not find "views" segment in URL path.',
    };
  }

  const workbookContentUrl = pathParts[viewsIndex + 1];
  const sheetContentUrl = pathParts[viewsIndex + 2];

  if (!workbookContentUrl) {
    return {
      type: 'no-workbook-found',
      message: 'Could not identify workbook name in URL.',
    };
  }

  // Check for site name (path-based URLs with /t/SiteName/)
  let siteName: string | undefined;
  const tIndex = pathParts.indexOf('t');
  if (tIndex !== -1 && pathParts[tIndex + 1]) {
    siteName = pathParts[tIndex + 1];
  }

  return {
    workbookContentUrl,
    sheetContentUrl: sheetContentUrl || undefined,
    siteName,
    url,
  };
}

/**
 * Checks if a parse result is an error
 */
export function isWorkbookUrlParseError(
  result: ParsedWorkbookUrl | WorkbookUrlParseError
): result is WorkbookUrlParseError {
  return 'type' in result && ['invalid-url', 'no-workbook-found'].includes(result.type);
}

/**
 * Builds a content URL filter string for querying workbooks by name.
 * This can be used with the Tableau REST API filter parameter.
 * 
 * @param workbookContentUrl - The workbook content URL from parsing
 * @returns A filter string for the REST API
 */
export function buildWorkbookContentUrlFilter(workbookContentUrl: string): string {
  return `contentUrl:eq:${workbookContentUrl}`;
}
