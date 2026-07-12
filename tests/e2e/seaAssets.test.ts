import { readFileSync, rmSync } from 'fs';

import { buildAssetsMap, DESKTOP_ASSET_DIRS, MANIFEST_KEY } from '../../src/scripts/seaAssets.js';
import { buildVariant } from './build.js';

type SeaAssetMap = Record<string, string>;

function toSeaAssetStore(assets: Record<string, string>, manifestPath: string): SeaAssetMap {
  const store: SeaAssetMap = {};
  for (const [key, absPath] of Object.entries(assets)) {
    store[key] = readFileSync(absPath, 'utf-8');
  }
  store[MANIFEST_KEY] = readFileSync(manifestPath, 'utf-8');
  return store;
}

async function importWithSeaAssets(
  assets: SeaAssetMap,
): Promise<typeof import('../../src/desktop/assets.js')> {
  vi.resetModules();
  const module = await import('../../src/desktop/assets.js');
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

describe('every embedded desktop SEA asset is readable under SEA', () => {
  let assets: Record<string, string>;
  let manifestPath: string;

  beforeAll(async () => {
    await buildVariant('desktop');
    const built = await buildAssetsMap(DESKTOP_ASSET_DIRS, 'desktop');
    assets = built.assets;
    if (!built.manifestPath) {
      throw new Error('desktop build produced no asset manifest');
    }
    manifestPath = built.manifestPath;
  }, 120_000);

  afterAll(() => {
    vi.resetModules();
    if (manifestPath) {
      rmSync(manifestPath, { force: true });
    }
  });

  it('embeds both configured asset roots', () => {
    const keys = Object.keys(assets).filter((key) => key !== MANIFEST_KEY);
    expect(keys.some((key) => key.startsWith('resources/desktop/'))).toBe(true);
    expect(keys.some((key) => key.startsWith('desktop/data/'))).toBe(true);
  });

  it('reads every embedded asset back through the verified seam', async () => {
    const store = toSeaAssetStore(assets, manifestPath);
    const { readDataAsset, readResourceAsset } = await importWithSeaAssets(store);

    for (const key of Object.keys(assets)) {
      if (key === MANIFEST_KEY) {
        continue;
      }
      const expected = store[key];
      if (key.startsWith('desktop/data/')) {
        const rel = key.slice('desktop/data/'.length);
        expect(() => readDataAsset(rel), key).not.toThrow();
        expect(readDataAsset(rel), key).toBe(expected);
      } else if (key.startsWith('resources/desktop/')) {
        const rel = key.slice('resources/desktop/'.length);
        expect(() => readResourceAsset(rel), key).not.toThrow();
        expect(readResourceAsset(rel), key).toBe(expected);
      } else {
        throw new Error(`embedded asset key under no known root: ${key}`);
      }
    }
  });
});
