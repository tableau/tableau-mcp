import http from 'http';
import supertest from 'supertest';

let server: http.Server | undefined;
let currentApp: http.RequestListener | undefined;

// listen(port, host) resolves the address asynchronously, so supertest cannot get a bound port from
// a server created inside request(). Bind once per test in a hook instead, on 127.0.0.1 explicitly:
// supertest's own server listens on `::` while its client dials 127.0.0.1, where another process's
// listener on the same ephemeral port can answer instead.
export async function startLoopbackServer(): Promise<void> {
  const loopback = http.createServer((req, res) => currentApp?.(req, res));
  await new Promise<void>((resolve, reject) => {
    loopback.once('error', reject);
    loopback.listen(0, '127.0.0.1', () => {
      loopback.off('error', reject);
      resolve();
    });
  });
  server = loopback;
}

export async function closeLoopbackServer(): Promise<void> {
  const closing = server;
  server = undefined;
  currentApp = undefined;
  if (!closing) {
    return;
  }

  closing.closeAllConnections();
  await new Promise<void>((resolve) => closing.close(() => resolve()));
}

export default function request(app: http.RequestListener): ReturnType<typeof supertest> {
  if (!server) {
    throw new Error(
      'Loopback test server is not started; call startLoopbackServer() in a beforeEach',
    );
  }

  if (currentApp && currentApp !== app) {
    throw new Error('Loopback test server serves one app per test; request() got a second app');
  }

  currentApp = app;
  return supertest(server);
}
