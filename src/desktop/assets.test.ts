import { createHash } from 'crypto';

type SeaAssets = Record<string, string>;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function importWithSeaAssets(assets: SeaAssets): Promise<typeof import('./assets.js')> {
  vi.resetModules();
  const module = await import('./assets.js');
  module._setSeaApiForTest({
    isSea: () => true,
    getAsset: (key: string, encoding?: string) => {
      const value = assets[key];
      if (value === undefined) {
        throw new Error(`missing SEA asset: ${key}`);
      }
      return encoding === 'utf8' ? value : new TextEncoder().encode(value).buffer;
    },
  });
  return module;
}

afterEach(() => {
  vi.doUnmock('node:sea');
  vi.resetModules();
});

describe('desktop SEA asset access', () => {
  it('fails closed when the SEA asset-manifest.json listing is missing', async () => {
    const { listDataAssetNames } = await importWithSeaAssets({});

    expect(() => listDataAssetNames('template-manifests')).toThrow(/asset-manifest\.json/i);
  });

  it('fails closed when the SEA asset-manifest.json listing is corrupt', async () => {
    const { listDataAssetNames } = await importWithSeaAssets({
      'asset-manifest.json': '{not json',
    });

    expect(() => listDataAssetNames('template-manifests')).toThrow(/asset-manifest\.json/i);
  });

  it('verifies SEA desktop/data asset bytes against content-manifest.json', async () => {
    const manifestText = JSON.stringify({
      content_version: '2.24.0+content.2026-07-08',
      schema_version: '1',
      generated: '2026-07-08',
      engine_compat: { server_min: '2.24.0', node: '>=22.7.5' },
      resources: [
        {
          path: 'template-manifests/example.manifest.json',
          sha256: '0'.repeat(64),
          bytes: 16,
        },
      ],
    });
    const { readDataAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify([
        'desktop/data/content-manifest.json',
        'desktop/data/template-manifests/example.manifest.json',
      ]),
      'desktop/data/content-manifest.json': manifestText,
      'desktop/data/template-manifests/example.manifest.json': '{"template":"x"}',
    });

    expect(() => readDataAsset('template-manifests/example.manifest.json')).toThrow(
      /template-manifests\/example\.manifest\.json.*sha256/i,
    );
  });

  it('returns SEA desktop/data asset bytes when the content hash matches', async () => {
    const assetText = '{"template":"x"}';
    const manifestText = JSON.stringify({
      content_version: '2.24.0+content.2026-07-08',
      schema_version: '1',
      generated: '2026-07-08',
      engine_compat: { server_min: '2.24.0', node: '>=22.7.5' },
      resources: [
        {
          path: 'template-manifests/example.manifest.json',
          sha256: sha256(assetText),
          bytes: Buffer.byteLength(assetText),
        },
      ],
    });
    const { readDataAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify([
        'desktop/data/content-manifest.json',
        'desktop/data/template-manifests/example.manifest.json',
      ]),
      'desktop/data/content-manifest.json': manifestText,
      'desktop/data/template-manifests/example.manifest.json': assetText,
    });

    expect(readDataAsset('template-manifests/example.manifest.json')).toBe(assetText);
  });
});
