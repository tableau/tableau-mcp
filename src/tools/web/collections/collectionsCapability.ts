import { Ok, Result } from 'ts-results-es';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { getTableauServerInfo } from '../../../getTableauServerInfo.js';
import { ServerInfo } from '../../../sdks/tableau/types/serverInfo.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

/**
 * Collections shipped on different Cloud and Server release trains. Check the actual target's
 * server info rather than the shared RestApi.version (or changing the global API default).
 * https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_collections.htm
 */
export function supportsCollections(server: string, info: ServerInfo): boolean {
  let hostname: string;
  try {
    hostname = new URL(server).hostname.toLowerCase();
  } catch {
    return false;
  }

  const apiMatch = /^(\d+)\.(\d+)$/.exec(info.restApiVersion);
  if (!apiMatch) return false;
  const [, major, minor] = apiMatch.map(Number);
  const apiAtLeast = (minimum: number): boolean => major > 3 || (major === 3 && minor >= minimum);

  // A strict suffix avoids treating attacker-controlled lookalike hosts as Tableau Cloud.
  if (hostname.endsWith('.online.tableau.com')) return apiAtLeast(28);

  const productMatch = /^(\d{4})\.(\d+)\.(\d+)$/.exec(info.productVersion.value);
  if (!productMatch) return false;
  const [, year, release] = productMatch.map(Number);
  return apiAtLeast(29) && (year > 2026 || (year === 2026 && release >= 2));
}

export async function checkCollectionsSupported(
  extra: TableauWebRequestHandlerExtra,
): Promise<Result<void, McpToolError>> {
  // Match useRestApi's configured-server precedence.
  const server = extra.config.server || extra.tableauAuthInfo?.server;
  if (!server || !supportsCollections(server, await getTableauServerInfo(server))) {
    return new McpToolError({
      type: 'collections-version-unsupported',
      statusCode: 400,
      message:
        'Collections REST API requires Tableau Cloud February 2026 / REST API 3.28 or later, ' +
        'or Tableau Server 2026.2 / REST API 3.29 or later. This target is older or its ' +
        'deployment/version could not be verified. No Collections request was sent.',
    }).toErr();
  }
  return new Ok(undefined);
}
