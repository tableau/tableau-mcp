// Minimal Tableau REST stand-in for the v2 smoke test: startup, list-datasources, and update-user.
import http from 'node:http';

const port = Number(process.argv[2] ?? 3999);
const ADMIN_LUID = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';
const roles = new Map<string, string>([[ADMIN_LUID, 'SiteAdministratorCreator']]);

http
  .createServer((req, res) => {
    const url = req.url ?? '';
    const send = (body: unknown): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };
    if (url.endsWith('/serverinfo')) {
      return send({
        serverInfo: {
          productVersion: { value: '2026.3.0', build: '20263.0' },
          restApiVersion: '3.28',
        },
      });
    }
    if (url.endsWith('/auth/signin')) {
      return send({
        credentials: { site: { id: 'site-luid' }, user: { id: ADMIN_LUID }, token: 't' },
      });
    }
    if (url.includes('/datasources')) {
      return send({
        pagination: { pageNumber: '1', pageSize: '100', totalAvailable: '1' },
        datasources: {
          datasource: [
            { id: 'ds-1', name: 'Superstore', project: { id: 'p', name: 'Default' }, tags: {} },
          ],
        },
      });
    }
    if (url.endsWith('/sessions/current')) {
      return send({
        session: {
          site: { id: 'site-luid', name: 'x', contentUrl: 'x' },
          user: { id: ADMIN_LUID, name: 'admin', siteRole: roles.get(ADMIN_LUID) },
        },
      });
    }
    const userMatch = url.match(/\/sites\/[^/]+\/users\/([^/?]+)$/);
    if (userMatch) {
      const id = userMatch[1];
      const user = (): unknown => ({
        user: {
          id,
          name: `user-${id.slice(0, 4)}`,
          email: 'u@example.com',
          siteRole: roles.get(id) ?? 'Creator',
        },
      });
      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          roles.set(id, JSON.parse(body).user.siteRole);
          console.error(`mock: PUT user ${id} siteRole=${roles.get(id)}`);
          send(user());
        });
        return;
      }
      return send(user());
    }
    if (url.endsWith('/auth/signout')) {
      return res.writeHead(204).end();
    }
    console.error('mock: unhandled', req.method, url);
    send({});
  })
  .listen(port, '127.0.0.1', () => console.error(`mock tableau on ${port}`));
