import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CATALOGS = [
  new URL('../../scripts/fixtures/exchange-products.json', import.meta.url),
];

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

const paragraphs = (html) =>
  String(html ?? '')
    .replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

function listingPage(product) {
  const tags = product.typed_tags.map((tag) => `<li>${escapeHtml(tag.name)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(product.name)} | Demo Exchange listing</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1f2937}
.banner{background:#fef3c7;border:1px solid #f59e0b;padding:.5rem 1rem;border-radius:6px}
.meta{color:#6b7280}ul{display:flex;gap:.5rem;flex-wrap:wrap;list-style:none;padding:0}li{background:#e5e7eb;border-radius:999px;padding:.1rem .7rem}</style></head>
<body><p class="banner">Demo listing: invented for the Exchange MCP demo and not published on Tableau Exchange.</p>
<h1>${escapeHtml(product.name)}</h1>
<p class="meta">${escapeHtml(product.product_type)} · ${escapeHtml(product.publisher_name)} · ${escapeHtml(product.downloads ?? 0)} downloads${product.details?.version_number ? ` · version ${escapeHtml(product.details.version_number)}` : ''}</p>
<p><strong>${escapeHtml(product.short_description)}</strong></p>${paragraphs(product.detailed_description)}
<ul>${tags}</ul>${product.details?.installation_instructions ? `<h2>Installation</h2>${paragraphs(product.details.installation_instructions)}` : ''}
</body></html>`;
}

/**
 * Serves one or more fixture catalogs; later files override earlier products with the same ID.
 * Files are reread when they change on disk, so editing a seed file "publishes" a listing to the
 * next MCP catalog refresh. Products from a file with `listingRedirectBase` (a live-catalog
 * snapshot) redirect their /web listing page to that site; others get a local demo page.
 */
export async function startFixtureGallery(port = 0, catalogFiles = DEFAULT_CATALOGS) {
  const catalogs = catalogFiles.map((file) => ({ file, mtimeMs: undefined, data: undefined }));
  const fixture = { products: [], tags: [] };
  const redirects = new Map();
  const reload = async () => {
    let changed = false;
    for (const catalog of catalogs) {
      const { mtimeMs } = await stat(catalog.file);
      if (mtimeMs === catalog.mtimeMs) continue;
      catalog.data = JSON.parse(await readFile(catalog.file, 'utf8'));
      catalog.mtimeMs = mtimeMs;
      changed = true;
    }
    if (!changed) return;
    const products = new Map();
    const tags = new Map();
    redirects.clear();
    for (const { data } of catalogs) {
      for (const product of data.products) {
        products.set(product.id, product);
        if (data.listingRedirectBase) redirects.set(product.id, data.listingRedirectBase);
        else redirects.delete(product.id);
      }
      for (const tag of data.tags ?? []) tags.set(tag.id, tag);
    }
    fixture.products = [...products.values()];
    fixture.tags = [...tags.values()];
  };
  let reloading;
  const reloadOnce = () => (reloading ??= reload().finally(() => (reloading = undefined)));
  await reloadOnce();

  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      await reloadOnce();
    } catch {
      response.statusCode = 500;
      return response.end('Fixture catalog could not be read');
    }
    const page = /^\/web\/products\/(\d+)$/.exec(url.pathname);
    if (page && request.method === 'GET') {
      const id = Number(page[1]);
      const redirectBase = redirects.get(id);
      if (redirectBase) {
        response.writeHead(302, { Location: new URL(`products/${id}`, redirectBase).href });
        return response.end();
      }
      const product = fixture.products.find((item) => item.id === id);
      response.writeHead(product ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(product ? listingPage(product) : '<h1>Listing not found</h1>');
    }
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
  const files = process.argv.slice(3).map((file) => resolve(file));
  const gallery = await startFixtureGallery(rawPort, files.length ? files : undefined);
  process.stderr.write(
    `Declared fixture Gallery API: ${gallery.url}\nListing pages: ${gallery.url}web/products/{id}\nSet EXCHANGE_CATALOG_SOURCE=declared-fixture; these IDs and links are fixtures.\n`,
  );
  process.on('SIGINT', () => {
    gallery.server.close();
  });
  process.on('SIGTERM', () => {
    gallery.server.close();
  });
}
