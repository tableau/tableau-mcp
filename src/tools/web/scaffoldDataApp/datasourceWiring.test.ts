import { buildDatasourceWiringInfo } from './datasourceWiring.js';

describe('buildDatasourceWiringInfo', () => {
  it('returns the host, site contentUrl, and default https port for a Cloud pod', () => {
    expect(
      buildDatasourceWiringInfo({
        serverUrl: 'https://10ax.online.tableau.com',
        siteName: 'mcp-test',
      }),
    ).toMatchObject({
      server: '10ax.online.tableau.com',
      site: 'mcp-test',
      channel: 'https',
      port: 443,
    });
  });

  it('drops any path or trailing slash from the server URL', () => {
    expect(
      buildDatasourceWiringInfo({ serverUrl: 'https://my-server.com/', siteName: 'a' }).server,
    ).toBe('my-server.com');
  });

  it('uses http and port 80 for a plain-http on-prem server', () => {
    expect(
      buildDatasourceWiringInfo({ serverUrl: 'http://tableau.corp.local', siteName: 'a' }),
    ).toMatchObject({ server: 'tableau.corp.local', channel: 'http', port: 80 });
  });

  it('keeps an explicit port', () => {
    expect(
      buildDatasourceWiringInfo({ serverUrl: 'https://tableau.corp.local:8443', siteName: 'a' }),
    ).toMatchObject({ server: 'tableau.corp.local', channel: 'https', port: 8443 });
  });

  it.each(['', 'Default'])('returns "" for the Default site (siteName %j)', (siteName) => {
    expect(buildDatasourceWiringInfo({ serverUrl: 'https://my-server.com', siteName }).site).toBe(
      '',
    );
  });
});
