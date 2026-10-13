import { GalleryApiClient } from './GalleryApiClient.js';

describe('GalleryApiClient', () => {
  const create = (fetchFn: typeof fetch): GalleryApiClient =>
    new GalleryApiClient({
      apiBaseUrl: new URL('https://gallery.example/api/'),
      timeoutMs: 20,
      fetchFn,
    });
  it('uses only fixed GET paths, real items/tags envelopes, and normalized locale', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], page: 1, per_page: 2, total: null, next: null })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: [] })));
    const client = create(fetchFn);
    expect(
      await client.listProducts({
        type: 'skill',
        locale: 'en-US',
        page: 1,
        perPage: 2,
        community: true,
      }),
    ).toMatchObject({ products: [], total: null });
    await client.listTags({ locale: 'en_US' });
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      'https://gallery.example/api/products?digest=true&type=skill&lang=en_us&page=1&per_page=2&include_community=true',
    );
    expect(String(fetchFn.mock.calls[1][0])).toBe('https://gallery.example/api/tags?lang=en_us');
    expect(
      fetchFn.mock.calls.every(
        ([, options]) =>
          options?.method === 'GET' &&
          options.redirect === 'manual' &&
          options.credentials === 'omit',
      ),
    ).toBe(true);
  });
  it('retries a transient status once, but not 404, redirects, malformed data or oversized bodies', async () => {
    const transient = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"tags":[]}'));
    expect(await create(transient).listTags({ locale: 'en_us' })).toEqual([]);
    expect(transient).toHaveBeenCalledTimes(2);
    for (const response of [
      new Response('', { status: 404 }),
      new Response('', { status: 302 }),
      new Response('{"tags":"wrong"}'),
      new Response('', { headers: { 'content-length': '9000000' } }),
    ]) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(create(fetchFn).listTags({ locale: 'en_us' })).rejects.toMatchObject({
        kind: response.status === 404 ? 'not-found' : 'invalid-response',
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });
  it('aborts stalled calls with a bounded retry and exposes no upstream error text', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('private upstream body')),
            { once: true },
          );
        }),
    );
    await expect(create(fetchFn).listTags({ locale: 'en_us' })).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'The Exchange catalog is temporarily unavailable.',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('rejects URL credentials, non-loopback HTTP and invalid pagination before fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    for (const url of [
      'http://remote.example/',
      'https://user:password@gallery.example/',
      'https://gallery.example/?token=fixture',
      'https://gallery.example/#fragment',
    ])
      expect(
        () => new GalleryApiClient({ apiBaseUrl: new URL(url), timeoutMs: 20, fetchFn }),
      ).toThrow();
    await expect(
      create(fetchFn).listProducts({
        type: 'skill',
        locale: 'en_us',
        page: 1,
        perPage: 1,
        community: false,
      }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['fr-FR', 'Instructions françaises'],
    ['en-US', 'English instructions'],
  ])('selects %s connector instructions before strict projection', async (locale, expected) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          name: 'Connector',
          product_type: 'connector',
          publisher_name: 'Vendor',
          typed_tags: [],
          community_contribution: false,
          private_product_field: 'private',
          details: {
            installation_instructions: 'English instructions',
            installation_instructions_fr_fr: 'Instructions françaises',
            installation_instructions_unsupported: 'Unsupported locale',
            driver_download_url: 'https://private.invalid/driver.taco',
            private_detail_field: 'private',
          },
        }),
      ),
    );
    const product = await create(fetchFn).getProduct({ productId: 1, locale });
    expect(product.details).toEqual({ installation_instructions: expected });
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      `https://gallery.example/api/products/1?lang=${locale.toLowerCase().replace('-', '_')}`,
    );
    expect(JSON.stringify(product)).not.toMatch(/private|unsupported|instructions_fr_fr/);
  });

  it.each([undefined, null, '', '   ', 123, { text: 'Malformed' }])(
    'falls back to English when localized instructions are unavailable: %j',
    async (localized) => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 1,
            name: 'Connector',
            product_type: 'connector',
            publisher_name: 'Vendor',
            typed_tags: [],
            community_contribution: false,
            details: {
              installation_instructions: 'English instructions',
              installation_instructions_fr_fr: localized,
            },
          }),
        ),
      );
      const product = await create(fetchFn).getProduct({ productId: 1, locale: 'fr_fr' });
      expect(product.details).toEqual({ installation_instructions: 'English instructions' });
    },
  );
});
