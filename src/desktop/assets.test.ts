import { createHash } from 'crypto';

type SeaAssets = Record<string, string>;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function manifestEntry(text: string): { sha256: string; bytes: number } {
  return { sha256: sha256(text), bytes: Buffer.byteLength(text) };
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

  it('fails closed when the SEA asset-manifest.json listing is not the { key: entry } shape', async () => {
    const { listDataAssetNames } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify(['desktop/data/x.json']),
    });

    expect(() => listDataAssetNames('template-manifests')).toThrow(/asset-manifest\.json/i);
  });

  it('verifies SEA asset bytes against the asset-manifest.json hash', async () => {
    const assetText = '{"template":"x"}';
    const { readDataAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify({
        'desktop/data/template-manifests/example.manifest.json': {
          sha256: '0'.repeat(64),
          bytes: 16,
        },
      }),
      'desktop/data/template-manifests/example.manifest.json': assetText,
    });

    expect(() => readDataAsset('template-manifests/example.manifest.json')).toThrow(
      /template-manifests\/example\.manifest\.json.*sha256/i,
    );
  });

  it('returns SEA asset bytes when the content hash matches', async () => {
    const assetText = '{"template":"x"}';
    const { readDataAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify({
        'desktop/data/template-manifests/example.manifest.json': manifestEntry(assetText),
      }),
      'desktop/data/template-manifests/example.manifest.json': assetText,
    });

    expect(readDataAsset('template-manifests/example.manifest.json')).toBe(assetText);
  });

  it('returns null for a desktop/data asset that is not embedded (not in the manifest)', async () => {
    const { readDataAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify({}),
    });

    expect(readDataAsset('template-manifests/absent.manifest.json')).toBeNull();
  });

  it('verifies resources/desktop assets through the same manifest', async () => {
    const assetText = '# knowledge';
    const { readResourceAsset } = await importWithSeaAssets({
      'asset-manifest.json': JSON.stringify({
        'resources/desktop/knowledge/viz-design/chart-selection.md': manifestEntry(assetText),
      }),
      'resources/desktop/knowledge/viz-design/chart-selection.md': assetText,
    });

    expect(readResourceAsset('knowledge/viz-design/chart-selection.md')).toBe(assetText);
  });

  it('verifies raw bytes, so a non-UTF-8 asset passes when its build-time byte hash matches', async () => {
    const key = 'desktop/data/example.bin';
    const raw = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80]);
    const bytes = Buffer.from(raw);
    vi.resetModules();
    const module = await import('./assets.js');
    module._setSeaApiForTest({
      isSea: () => true,
      getAsset: (assetKey: string, encoding?: string) => {
        if (assetKey === 'asset-manifest.json') {
          return JSON.stringify({
            [key]: {
              sha256: createHash('sha256').update(bytes).digest('hex'),
              bytes: bytes.byteLength,
            },
          });
        }
        if (assetKey === key) {
          return encoding === 'utf8' ? bytes.toString('utf-8') : raw.buffer;
        }
        throw new Error(`missing SEA asset: ${assetKey}`);
      },
    });

    expect(() => module.readDataAsset('example.bin')).not.toThrow();
    expect(module.readDataAsset('example.bin')).toBe(bytes.toString('utf-8'));
  });
});
