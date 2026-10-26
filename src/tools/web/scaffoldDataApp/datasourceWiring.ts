/**
 * The connection values a data app's published-datasource wiring needs, resolved from the session
 * the scaffold ran in. Returned by scaffold-data-app so the agent never has to derive the host or
 * site from some other tool's URLs; keys match the wiring descriptor's so they copy across as is.
 */
export interface DatasourceWiringInfo {
  /** Host only, no scheme or port (e.g. `10ax.online.tableau.com`). */
  server: string;
  /** Site contentUrl; `""` for the Default site. */
  site: string;
  channel: 'http' | 'https';
  port: number;
}

export function buildDatasourceWiringInfo({
  serverUrl,
  siteName,
}: {
  serverUrl: string;
  siteName: string;
}): DatasourceWiringInfo {
  const url = new URL(serverUrl);
  const channel = url.protocol === 'http:' ? 'http' : 'https';
  return {
    server: url.hostname,
    // The wiring script and the site's URLs both treat "Default" as the unnamed Default site.
    site: siteName === 'Default' ? '' : siteName,
    channel,
    port: url.port ? Number(url.port) : channel === 'https' ? 443 : 80,
  };
}
