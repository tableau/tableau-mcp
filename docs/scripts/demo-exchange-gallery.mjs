import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startFixtureGallery(port = 0) {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../scripts/fixtures/exchange-products.json', import.meta.url),
      'utf8',
    ),
  );
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    // Keep only a bounded tail for integration assertions during long demo sessions.
    if (requests.length === 1_000) requests.shift();
    requests.push({
      method: request.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
    response.setHeader('Content-Type', 'application/json');
    const reply = (status, value) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
    };
    if (request.method !== 'GET') return reply(405, { error: 'Read-only fixture API' });
    if (url.pathname === '/tags') return reply(200, { tags: fixture.tags });
    if (url.pathname === '/products') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 100);
      const type = url.searchParams.get('type');
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(perPage) ||
        perPage < 2 ||
        perPage > 1000
      )
        return reply(400, { error: 'Invalid pagination' });
      // Reproduce Gallery: global type page first, then the community partition.
      const candidates = fixture.products.filter((product) => product.product_type === type);
      const slice = candidates.slice((page - 1) * perPage, page * perPage);
      const community = url.searchParams.get('include_community') === 'true';
      const items = slice
        .filter((product) => product.community_contribution === community)
        .map(
          ({
            detailed_description: _detailedDescription,
            details: _details,
            manifest_file_name: _manifestFileName,
            product_download_url: _productDownloadUrl,
            ...digest
          }) => digest,
        );
      return reply(200, {
        page,
        per_page: perPage,
        total: items.length ? null : 0,
        next: null,
        items,
      });
    }
    const match = /^\/products\/(\d+)$/.exec(url.pathname);
    if (match) {
      const product = fixture.products.find((item) => item.id === Number(match[1]));
      return product ? reply(200, product) : reply(404, { error: 'Not found' });
    }
    return reply(404, { error: 'No fixture route' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    requests,
    fixture,
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawPort = Number(process.argv[2] ?? 3928);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535)
    throw new Error('Provide a port from 1 to 65535.');
  const gallery = await startFixtureGallery(rawPort);
  process.stderr.write(
    `Declared fixture Gallery API: ${gallery.url}\nSet EXCHANGE_CATALOG_SOURCE=declared-fixture; these IDs and links are fixtures.\n`,
  );
  process.on('SIGINT', () => {
    gallery.server.close();
  });
  process.on('SIGTERM', () => {
    gallery.server.close();
  });
}
