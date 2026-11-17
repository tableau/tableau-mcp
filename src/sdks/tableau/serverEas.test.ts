import express from 'express';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { getJwt } from '../../utils/getJwt.js';

vi.mock('../../utils/getJwt.js', () => ({ getJwt: vi.fn() }));

describe('supplied EAS JWT', () => {
  let server: Server;
  let host: string;
  const signIn = vi.fn();
  const signOut = vi.fn();
  const credentials = {
    token: 'opaque-tableau-credential',
    site: { id: 'site-id' },
    user: { id: 'user-id' },
  };
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/3.30/auth/signin', (req, res) => {
      signIn(req.body);
      res.json({ credentials });
    });
    app.post('/api/3.30/auth/signout', (req, res) => {
      signOut(req.headers['x-tableau-auth']);
      res.status(204).end();
    });
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('exchanges the original assertion and reuses all returned credentials without decoding the session', async () => {
    const { RestApi } = await vi.importActual<typeof import('./restApi.js')>('./restApi.js');
    RestApi.host = host;
    RestApi.version = '3.30';
    const api = new RestApi({ maxRequestTimeoutMs: 1000 });
    await api.signIn({
      type: 'server-eas',
      siteName: 'target',
      jwt: 'original.unmodified.assertion',
    });
    expect(signIn).toHaveBeenCalledWith({
      credentials: { jwt: 'original.unmodified.assertion', site: { contentUrl: 'target' } },
    });
    expect(getJwt).not.toHaveBeenCalled();
    expect(api.sessionCredentials).toEqual(credentials);
    const reused = new RestApi({ maxRequestTimeoutMs: 1000 });
    reused.setCredentials(api.sessionCredentials);
    expect(reused.siteId).toBe('site-id');
    expect(reused.userId).toBe('user-id');
    await reused.signOut();
    expect(signOut).toHaveBeenCalledWith('opaque-tableau-credential');
  });

  it('preserves legacy token-shape validation and rejects session extraction from a bearer', async () => {
    const { RestApi } = await vi.importActual<typeof import('./restApi.js')>('./restApi.js');
    const api = new RestApi({ maxRequestTimeoutMs: 1000 });
    expect(() => api.setCredentials('opaque', 'user')).toThrow('3 parts');
    api.setBearerToken('bearer');
    expect(() => api.sessionCredentials).toThrow('Tableau session');
  });
});
