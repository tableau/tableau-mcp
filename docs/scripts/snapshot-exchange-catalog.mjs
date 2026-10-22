import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TYPES = ['skill', 'extension', 'viz', 'connector', 'accelerator'];
const PER_PAGE = 1000;
const DETAIL_CONCURRENCY = 8;

/**
 * Saves raw Gallery API responses (digest list, per-product detail, tags) in the fixture file
 * shape served by demo-exchange-gallery.mjs, so a demo can run against a frozen copy of a live
 * catalog plus seeded listings.
 */
export async function snapshotCatalog({ apiBaseUrl, locale = 'en_us', listingRedirectBase }) {
  const get = async (path, params = {}) => {
    const url = new URL(path, apiBaseUrl);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`);
    return response.json();
  };

  const ids = new Set();
  for (const type of TYPES)
    for (const community of [false, true])
      for (let page = 1; ; page++) {
        const { items } = await get('products', {
          digest: 'true',
          type,
          lang: locale,
          page: String(page),
          per_page: String(PER_PAGE),
          include_community: String(community),
        });
        for (const item of items) ids.add(item.id);
        if (items.length < PER_PAGE) break;
      }

  const queue = [...ids];
  const products = [];
  await Promise.all(
    Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift())
        products.push(await get(`products/${id}`, { lang: locale }));
    }),
  );
  products.sort((left, right) => left.id - right.id);

  const { tags } = await get('tags', { lang: locale });
  return {
    source: 'gallery-api-snapshot',
    snapshotOf: apiBaseUrl,
    snapshotAt: new Date().toISOString(),
    listingRedirectBase,
    products,
    tags,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [apiBaseUrl, output, listingRedirectBase = 'https://exchange.tableau.com/'] =
    process.argv.slice(2);
  if (!apiBaseUrl || !output)
    throw new Error(
      'Usage: node docs/scripts/snapshot-exchange-catalog.mjs <gallery-api-url> <output.json> [listing-redirect-base]',
    );
  const snapshot = await snapshotCatalog({ apiBaseUrl, listingRedirectBase });
  await writeFile(output, `${JSON.stringify(snapshot)}\n`);
  process.stderr.write(
    `Saved ${snapshot.products.length} products and ${snapshot.tags.length} tags to ${output}\n`,
  );
}
