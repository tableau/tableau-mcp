const rawContentManifest = {
  content_version: '2.24.0+content.2026-07-08',
  schema_version: '1',
  generated: '2026-07-08',
  engine_compat: { server_min: '2.24.0', node: '>=22.7.5' },
  resources: [],
};

async function importProviderWithAssetOnlyData(): Promise<typeof import('./provider.js')> {
  vi.resetModules();
  vi.doMock('../binder/manifest.js', () => ({
    CONTENT_MANIFEST_PATH: '/missing/content-manifest.json',
    TEMPLATE_XML_DIR: '/missing/data-visualization-templates-xml',
    loadManifests: () =>
      new Map([
        [
          'ranking-ordered-bar',
          {
            template: 'ranking-ordered-bar',
          },
        ],
      ]),
  }));
  vi.doMock('../assets.js', () => ({
    readDataAsset: (relPath: string) => {
      if (relPath === 'content-manifest.json') {
        return JSON.stringify(rawContentManifest);
      }
      if (relPath === 'data-visualization-templates-xml/ranking-ordered-bar.xml') {
        return '<worksheet name="ranking-ordered-bar" />';
      }
      return null;
    },
  }));
  vi.doMock('fs', () => ({
    default: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('provider must not read desktop content from disk');
      },
    },
  }));
  return await import('./provider.js');
}

afterEach(() => {
  vi.doUnmock('../binder/manifest.js');
  vi.doUnmock('../assets.js');
  vi.doUnmock('fs');
  vi.resetModules();
});

describe('BundledIntelligenceProvider SEA asset routing', () => {
  it('loads content-manifest.json through the desktop asset accessor', async () => {
    const { BundledIntelligenceProvider } = await importProviderWithAssetOnlyData();

    expect(new BundledIntelligenceProvider().getContentManifest()).toEqual(rawContentManifest);
  });

  it('loads shipped template XML fragments through the desktop asset accessor', async () => {
    const { BundledIntelligenceProvider } = await importProviderWithAssetOnlyData();

    expect(new BundledIntelligenceProvider().getTemplateXmlFragment('ranking-ordered-bar')).toBe(
      '<worksheet name="ranking-ordered-bar" />',
    );
  });
});
