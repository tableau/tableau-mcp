import { galleryProductSchema } from './galleryApiSchemas.js';
import { normalizeProduct } from './ProductNormalizer.js';

const base = {
  id: 1,
  name: 'Workbook Skill',
  product_type: 'skill',
  publisher_name: 'Publisher',
  community_contribution: false,
  typed_tags: [],
};
describe('ProductNormalizer', () => {
  it('projects all five types and keeps Skill metadata and absent values unknown', () => {
    for (const type of ['skill', 'extension', 'viz', 'connector', 'accelerator']) {
      const raw = galleryProductSchema.parse({
        ...base,
        product_type: type,
        details: { placeholder_details: 'execute private package' },
        manifest_file_name: 'private.tskill',
        product_download_url: '/download',
      });
      const result = normalizeProduct(raw, new URL('https://exchange.example/'), 'detail');
      expect(result.type).toBe(type);
      expect(result.listingUrl).toBe('https://exchange.example/products/1');
      expect(result.downloads).toBeUndefined();
      expect(result.publishDate).toBeUndefined();
      expect(result.technicalMetadataStatus).toBe('unavailable');
      expect(result.details).toBeUndefined();
      expect(JSON.stringify(result)).not.toMatch(/private|manifest|download|placeholder/);
    }
  });
  it('includes safe typed details only for detail reads and rejects artifact/signed links', () => {
    const raw = galleryProductSchema.parse({
      ...base,
      product_type: 'connector',
      details: {
        version_number: '1.2',
        data_source_class: 'postgres',
        installation_instructions: '<script>evil()</script><p>Read docs</p>',
        driver_download_url: 'https://private.example/driver.zip',
      },
      support_url: 'https://example.test/?X-Amz-Signature=fixture',
      pictures: ['https://example.test/picture.png', 'https://example.test/package.tskill'],
    });
    const result = normalizeProduct(raw, new URL('https://exchange.example/'), 'detail');
    expect(result.details).toEqual({
      kind: 'connector',
      versionNumber: '1.2',
      dataSourceClass: 'postgres',
      installationInstructions: 'Read docs',
    });
    expect(result.technicalMetadataStatus).toBe('available');
    expect(result.supportUrl).toBeUndefined();
    expect(result.pictureUrls).toEqual(['https://example.test/picture.png']);
    expect(
      normalizeProduct(raw, new URL('https://exchange.example/'), 'summary').details,
    ).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('driver_download_url');
  });
  it('strips active markup and bounds detail text with explicit truncation', () => {
    const raw = galleryProductSchema.parse({
      ...base,
      short_description: '&lt;script&gt;evil&lt;/script&gt; Safe &amp; useful',
      detailed_description: 'x'.repeat(20_001),
    });
    const result = normalizeProduct(raw, new URL('https://exchange.example/'), 'detail');
    expect(result.shortDescription).toBe('Safe & useful');
    expect(result.detailedDescription).toHaveLength(20_000);
    expect(result.descriptionTruncated).toBe(true);
  });

  it.each([
    'products/1000:download',
    'extensions/1000:download',
    'viz/1000:download',
    'connectors/1000:download',
    'submissions/1000:download',
    'products/1000:getdownloadurl',
    'products/1000%3Adownload',
    'products%2F1000%3Agetdownloadurl',
    '%70roducts/1000%253Adownload',
    'products/1000%3Adownload/invalid%escape',
  ])('omits Gallery artifact actions from projected URLs and text: %s', (path) => {
    const artifactUrl = `https://gallery.example/api/${path}`;
    const listingUrl = 'https://exchange.example/products/1000';
    const supportUrl = 'https://support.example/download-help?discount=10%25';
    const raw = galleryProductSchema.parse({
      ...base,
      product_type: 'extension',
      support_url: artifactUrl,
      privacy_policy: supportUrl,
      product_icon_url: artifactUrl,
      pictures: [artifactUrl, listingUrl],
      short_description: `Use ${listingUrl} or ${artifactUrl}`,
      detailed_description: `Help ${supportUrl} ${artifactUrl}`,
      details: {
        extension_url: artifactUrl,
        public_examples: [
          { name: 'Artifact', url: artifactUrl },
          { name: 'Public listing', url: listingUrl },
        ],
      },
    });
    const result = normalizeProduct(raw, new URL('https://exchange.example/'), 'detail');
    expect(result.supportUrl).toBeUndefined();
    expect(result.iconUrl).toBeUndefined();
    expect(result.pictureUrls).toEqual([listingUrl]);
    expect(result.privacyPolicyUrl).toBe(supportUrl);
    expect(result.shortDescription).toBe(`Use ${listingUrl} or [link omitted]`);
    expect(result.detailedDescription).toBe(`Help ${supportUrl} [link omitted]`);
    expect(result.details).toEqual({
      kind: 'extension',
      publicExamples: [{ name: 'Public listing', url: listingUrl }],
    });
    expect(JSON.stringify(result)).not.toContain(artifactUrl);
  });
});
