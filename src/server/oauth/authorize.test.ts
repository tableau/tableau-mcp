import https from 'https';
import { isSSRFSafeURL } from 'ssrfcheck';
import { describe, expect, it, vi } from 'vitest';

import { axios } from '../../utils/axios.js';
import { getClientFromMetadataDoc } from './authorize.js';
import { getDnsResolver } from './dnsResolver.js';

vi.mock('ssrfcheck', () => ({
  isSSRFSafeURL: vi.fn(),
}));

vi.mock('./dnsResolver.js', () => ({
  getDnsResolver: vi.fn(),
}));

vi.mock('../../utils/axios.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/axios.js')>('../../utils/axios.js');
  return {
    ...actual,
    axios: { create: vi.fn() },
  };
});

describe('getClientFromMetadataDoc', () => {
  it('pins TLS SNI to the original hostname, not the resolved IP', async () => {
    const resolvedIp = '93.184.216.34';
    vi.mocked(getDnsResolver).mockReturnValue({
      resolve4: vi.fn().mockResolvedValue([resolvedIp]),
      resolve6: vi.fn(),
    } as unknown as ReturnType<typeof getDnsResolver>);
    vi.mocked(isSSRFSafeURL).mockReturnValue(true);

    const get = vi.fn().mockResolvedValue({
      headers: { 'content-type': 'application/json' },
      data: {
        client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
        redirect_uris: ['http://localhost:12345/callback'],
      },
    });
    vi.mocked(axios.create).mockReturnValue({ get } as unknown as ReturnType<typeof axios.create>);

    const result = await getClientFromMetadataDoc(
      new URL('https://claude.ai/oauth/claude-code-client-metadata'),
    );

    expect(result.isOk()).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);

    const [requestedUrl, requestConfig] = get.mock.calls[0];

    // The request is still pinned to the resolved IP (SSRF protection intact).
    expect(requestedUrl).toBe(`https://${resolvedIp}/oauth/claude-code-client-metadata`);
    expect(requestConfig.headers.Host).toBe('claude.ai');

    // The fix: SNI must be pinned to the original hostname, not the IP, so
    // SNI-routing CDNs (e.g. Cloudflare) fronting the client_id host resolve
    // the request correctly instead of rejecting it with a 403.
    expect(requestConfig.httpsAgent).toBeInstanceOf(https.Agent);
    expect(requestConfig.httpsAgent.options.servername).toBe('claude.ai');
  });
});
