import { generateKeyPairSync, sign, X509Certificate } from 'crypto';
import http from 'http';
import https from 'https';
import net from 'net';

import { stubDefaultEnvVars } from '../../testShared.js';
import { clientMetadataAgent, getClientFromMetadataDoc } from './authorize.js';
import { clientMetadataCache } from './clientMetadataCache.js';

const mocks = vi.hoisted(() => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

vi.mock('./dnsResolver.js', () => ({
  getDnsResolver: () => ({ resolve4: mocks.resolve4, resolve6: mocks.resolve6 }),
}));

// Allow the loopback addresses that the test servers listen on
vi.mock('ssrfcheck', async (importOriginal) => {
  const { isSSRFSafeURL } = await importOriginal<typeof import('ssrfcheck')>();
  return {
    isSSRFSafeURL: (...args: Parameters<typeof isSSRFSafeURL>) =>
      ['127.0.0.1', '[::1]'].includes(new URL(args[0]).hostname) || isSSRFSafeURL(...args),
  };
});

vi.mock('../../utils/retry.js', () => ({
  retry: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../logging/logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logging/logger.js')>()),
  log: vi.fn(),
}));

// .test names are reserved (RFC 6761), so only the mocked resolver resolves this one
const HOSTNAME = 'cimd.test';

describe('getClientFromMetadataDoc', () => {
  const certificate = createSelfSignedCertificate(HOSTNAME);
  const proxyCertificate = createSelfSignedCertificate('127.0.0.1');
  const servers: net.Server[] = [];
  const sockets = new Set<net.Socket>();

  beforeEach(() => {
    stubDefaultEnvVars();
    mocks.resolve4.mockResolvedValue(['127.0.0.1']);
    mocks.resolve6.mockResolvedValue([]);
    https.globalAgent.options.ca = certificate.cert;
    clientMetadataAgent.options.ca = [certificate.cert, proxyCertificate.cert];
    for (const name of ['https_proxy', 'all_proxy', 'no_proxy']) {
      vi.stubEnv(name, '');
      vi.stubEnv(name.toUpperCase(), '');
    }
    vi.stubEnv('OAUTH_CIMD_PROXY_RESOLVES_HOSTNAME', undefined);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete https.globalAgent.options.ca;
    delete clientMetadataAgent.options.ca;
    https.globalAgent.destroy();
    clientMetadataCache.clear();
    sockets.forEach((socket) => socket.destroy());
    sockets.clear();
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  async function listen(server: net.Server, host = '127.0.0.1'): Promise<number> {
    servers.push(server);
    server.on('connection', (socket: net.Socket) => sockets.add(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, resolve);
    });
    return (server.address() as net.AddressInfo).port;
  }

  async function startOrigin(
    handler: http.RequestListener,
    host?: string,
  ): Promise<{ url: string; servernames: string[]; hosts: string[]; connections: net.Socket[] }> {
    const servernames: string[] = [];
    const hosts: string[] = [];
    const connections: net.Socket[] = [];
    const server = https.createServer(
      {
        ...certificate,
        SNICallback: (servername, callback) => {
          servernames.push(servername);
          callback(null);
        },
      },
      (req, res) => {
        hosts.push(req.headers.host ?? '');
        handler(req, res);
      },
    );
    server.on('connection', (socket: net.Socket) => connections.push(socket));
    const port = await listen(server, host);
    return { url: `https://${HOSTNAME}:${port}/client.json`, servernames, hosts, connections };
  }

  const serveMetadata: http.RequestListener = (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        client_id: `https://${HOSTNAME}:${req.socket.localPort}${req.url}`,
        redirect_uris: ['http://127.0.0.1/callback'],
      }),
    );
  };

  /**
   * Starts a forward proxy and sets it as HTTPS_PROXY. It only handles CONNECT, which axios uses to
   * send HTTPS requests through a proxy. It connects to an IP address as given, and resolves a
   * hostname itself with `hosts`, which maps hostnames to the ports of local listeners.
   */
  async function startProxy({
    protocol = 'http',
    hosts = {},
    allowedHostnames,
  }: {
    protocol?: 'http' | 'https';
    hosts?: Record<string, number>;
    allowedHostnames?: string[];
  }): Promise<string[]> {
    const connectTargets: string[] = [];
    const proxy: http.Server =
      protocol === 'https' ? https.createServer(proxyCertificate) : http.createServer();
    proxy.on('connect', (req, socket, head) => {
      const target = req.url ?? '';
      connectTargets.push(target);
      socket.on('error', () => {});
      const url = URL.parse(`https://${target}`);
      if (!url) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const { hostname, port } = url;
      if (allowedHostnames && !allowedHostnames.includes(hostname)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = net.isIP(hostname)
        ? net.connect(Number(port), hostname)
        : net.connect(hosts[hostname], '127.0.0.1');
      upstream.on('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(socket).pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      sockets.add(upstream);
    });
    const proxyUrl = `${protocol}://127.0.0.1:${await listen(proxy)}`;
    vi.stubEnv('https_proxy', proxyUrl);
    vi.stubEnv('HTTPS_PROXY', proxyUrl);
    return connectTargets;
  }

  describe.each(['false', 'true'])('when OAUTH_CIMD_PROXY_RESOLVES_HOSTNAME is %s', (value) => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_CIMD_PROXY_RESOLVES_HOSTNAME', value);
    });

    it('connects to the resolved address with the hostname as the TLS server name', async () => {
      const origin = await startOrigin(serveMetadata);

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrap().client_id).toBe(origin.url);
      expect(origin.servernames).toEqual([HOSTNAME]);
      expect(origin.hosts).toEqual([new URL(origin.url).host]);
      expect(mocks.resolve4).toHaveBeenCalledTimes(1);
    });

    it('connects to the resolved IPv6 address', async ({ skip }) => {
      mocks.resolve4.mockResolvedValue([]);
      mocks.resolve6.mockResolvedValue(['::1']);
      const origin = await startOrigin(serveMetadata, '::1').catch(() =>
        skip('IPv6 loopback is not available'),
      );

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrap().client_id).toBe(origin.url);
      expect(origin.servernames).toEqual([HOSTNAME]);
      expect(origin.hosts).toEqual([new URL(origin.url).host]);
    });

    it('does not reuse connections opened by other requests', async () => {
      const origin = await startOrigin(serveMetadata);
      // Another request to the same host and port leaves an idle connection in the global agent
      const lookup: net.LookupFunction = (_hostname, options, callback) =>
        options.all
          ? callback(null, [{ address: '127.0.0.1', family: 4 }])
          : callback(null, '127.0.0.1', 4);
      await new Promise((resolve, reject) => {
        https
          .get(origin.url, { lookup }, (res) => res.resume().on('end', resolve))
          .on('error', reject);
      });

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrap().client_id).toBe(origin.url);
      expect(origin.connections).toHaveLength(2);
    });

    it('opens a new connection for each request', async () => {
      const origin = await startOrigin(serveMetadata);

      await getClientFromMetadataDoc(new URL(origin.url));
      clientMetadataCache.clear();
      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrap().client_id).toBe(origin.url);
      expect(origin.connections).toHaveLength(2);
    });

    it('rejects a certificate that is not trusted', async () => {
      const origin = await startOrigin(serveMetadata);
      delete https.globalAgent.options.ca;
      delete clientMetadataAgent.options.ca;

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(origin.servernames).toEqual([HOSTNAME]);
    });

    it('rejects a certificate for another hostname', async () => {
      const otherCertificate = createSelfSignedCertificate('other.test');
      clientMetadataAgent.options.ca = otherCertificate.cert;
      const port = await listen(https.createServer(otherCertificate, serveMetadata));

      const result = await getClientFromMetadataDoc(
        new URL(`https://${HOSTNAME}:${port}/client.json`),
      );

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
    });

    it.each([
      ['IPv4', ['192.0.2.1'], []],
      ['IPv6', [], ['2001:db8::1']],
    ])('rejects a resolved %s address that is not allowed', async (_family, ipv4, ipv6) => {
      mocks.resolve4.mockResolvedValue(ipv4);
      mocks.resolve6.mockResolvedValue(ipv6);

      const result = await getClientFromMetadataDoc(new URL(`https://${HOSTNAME}/client.json`));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Client Metadata URL is not allowed',
      });
    });

    it.each([
      [
        'resolves to an address that is not allowed',
        () => Promise.resolve(['192.0.2.1']),
        'Client Metadata URL is not allowed',
      ],
      [
        'cannot be resolved',
        () => Promise.reject(new Error('queryA ETIMEOUT')),
        'IP address of Client Metadata URL could not be resolved',
      ],
    ])(
      'rejects a hostname that %s when a proxy is configured',
      async (_case, resolve4, message) => {
        mocks.resolve4.mockImplementation(resolve4);
        const connectTargets = await startProxy({ allowedHostnames: [] });

        const result = await getClientFromMetadataDoc(new URL(`https://${HOSTNAME}/client.json`));

        expect(result.unwrapErr()).toEqual({
          error: 'invalid_request',
          error_description: message,
        });
        expect(connectTargets).toEqual([]);
      },
    );

    it('does not follow redirects', async () => {
      let redirectConnections = 0;
      const redirectTarget = net.createServer((socket) => {
        redirectConnections++;
        socket.destroy();
      });
      const redirectPort = await listen(redirectTarget);
      let originRequests = 0;
      const origin = await startOrigin((_req, res) => {
        originRequests++;
        res.writeHead(302, { location: `https://127.0.0.1:${redirectPort}/client.json` }).end();
      });

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(originRequests).toBe(1);
      expect(redirectConnections).toBe(0);
    });
  });

  describe.each(['http', 'https'] as const)('through an %s proxy by default', (protocol) => {
    it('asks the proxy to connect to the resolved address', async () => {
      const origin = await startOrigin(serveMetadata);
      // The proxy's own resolver answers the hostname with another listener, which stands for a
      // private address and must not receive a connection
      let privateConnections = 0;
      const privateTarget = net.createServer((socket) => {
        privateConnections++;
        socket.destroy();
      });
      const connectTargets = await startProxy({
        protocol,
        hosts: { [HOSTNAME]: await listen(privateTarget) },
      });

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      const { port } = new URL(origin.url);
      expect(connectTargets).toEqual([`127.0.0.1:${port}`]);
      expect(privateConnections).toBe(0);
      expect(origin.servernames).toEqual([HOSTNAME]);
      expect(origin.hosts).toEqual([`${HOSTNAME}:${port}`]);
      expect(result.unwrap().client_id).toBe(origin.url);
    });

    it('rejects a certificate that is not trusted', async () => {
      const untrustedCertificate = createSelfSignedCertificate(HOSTNAME);
      const port = await listen(https.createServer(untrustedCertificate, serveMetadata));
      const connectTargets = await startProxy({ protocol, hosts: { [HOSTNAME]: port } });

      const result = await getClientFromMetadataDoc(
        new URL(`https://${HOSTNAME}:${port}/client.json`),
      );

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(connectTargets).toEqual([`127.0.0.1:${port}`]);
    });

    it('is rejected by a proxy that only allows hostnames', async () => {
      const origin = await startOrigin(serveMetadata);
      const { port } = new URL(origin.url);
      const connectTargets = await startProxy({
        protocol,
        hosts: { [HOSTNAME]: Number(port) },
        allowedHostnames: [HOSTNAME],
      });

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(connectTargets).toEqual([`127.0.0.1:${port}`]);
      expect(origin.connections).toHaveLength(0);
    });

    it('does not send a resolved IPv6 address to the proxy', async () => {
      mocks.resolve4.mockResolvedValue([]);
      mocks.resolve6.mockResolvedValue(['::1']);
      let privateConnections = 0;
      const privateTarget = net.createServer((socket) => {
        privateConnections++;
        socket.destroy();
      });
      const connectTargets = await startProxy({
        protocol,
        hosts: { [HOSTNAME]: await listen(privateTarget) },
      });

      const result = await getClientFromMetadataDoc(new URL(`https://${HOSTNAME}/client.json`));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(connectTargets).toEqual([]);
      expect(privateConnections).toBe(0);
    });

    it('stops waiting for a proxy that does not answer', async () => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      const signalTimeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(50));
      onTestFinished(() => signalTimeout.mockRestore());
      // Receives CONNECT and never answers
      const proxy = (
        protocol === 'https' ? https.createServer(proxyCertificate) : http.createServer()
      ).on('connect', () => {});
      const proxyUrl = `${protocol}://127.0.0.1:${await listen(proxy)}`;
      vi.stubEnv('https_proxy', proxyUrl);
      vi.stubEnv('HTTPS_PROXY', proxyUrl);

      const result = await getClientFromMetadataDoc(new URL(`https://${HOSTNAME}/client.json`));

      expect(result.unwrapErr()).toEqual({
        error: 'invalid_request',
        error_description: 'Unable to fetch client metadata',
      });
      expect(signalTimeout).toHaveBeenCalledWith(5000);
    });
  });

  describe('through a proxy when OAUTH_CIMD_PROXY_RESOLVES_HOSTNAME is true', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_CIMD_PROXY_RESOLVES_HOSTNAME', 'true');
    });

    it.each(['http', 'https'] as const)('sends the hostname to an %s proxy', async (protocol) => {
      const origin = await startOrigin(serveMetadata);
      const { host, port } = new URL(origin.url);
      const connectTargets = await startProxy({
        protocol,
        hosts: { [HOSTNAME]: Number(port) },
        allowedHostnames: [HOSTNAME],
      });

      const result = await getClientFromMetadataDoc(new URL(origin.url));

      expect(connectTargets).toEqual([host]);
      expect(origin.servernames).toEqual([HOSTNAME]);
      expect(result.unwrap().client_id).toBe(origin.url);
    });
  });
});

/**
 * Creates a self-signed certificate for the hostname or IPv4 address at test runtime,
 * so that no key material needs to be committed.
 */
function createSelfSignedCertificate(hostname: string): { key: string; cert: string } {
  const der = (tag: number, ...content: Buffer[]): Buffer => {
    const body = Buffer.concat(content);
    const length =
      body.length < 0x80
        ? [body.length]
        : body.length < 0x100
          ? [0x81, body.length]
          : [0x82, body.length >> 8, body.length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
  };
  const sequence = (...content: Buffer[]): Buffer => der(0x30, ...content);
  const oid = (hex: string): Buffer => der(0x06, Buffer.from(hex, 'hex'));
  const text = (tag: number, value: string): Buffer => der(tag, Buffer.from(value));

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const name = sequence(der(0x31, sequence(oid('550403'), text(0x0c, hostname))));
  const subjectAltName = net.isIPv4(hostname)
    ? der(0x87, Buffer.from(hostname.split('.').map(Number))) // iPAddress
    : text(0x82, hostname); // dNSName
  const ecdsaWithSha256 = sequence(oid('2a8648ce3d040302'));
  const tbsCertificate = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))), // version 3
    der(0x02, Buffer.from([1])), // serial number
    ecdsaWithSha256,
    name, // issuer
    sequence(text(0x17, '000101000000Z'), text(0x17, '491231235959Z')), // validity
    name, // subject
    publicKey.export({ type: 'spki', format: 'der' }),
    // subjectAltName extension
    der(0xa3, sequence(sequence(oid('551d11'), der(0x04, sequence(subjectAltName))))),
  );
  const signature = sign('sha256', tbsCertificate, privateKey);
  const cert = sequence(tbsCertificate, ecdsaWithSha256, der(0x03, Buffer.from([0]), signature));

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: new X509Certificate(cert).toString(),
  };
}
