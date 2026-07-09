import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Regression guard for the #460 integrity gap: EVERY asset embedded into the SEA
// blob must be readable at runtime through the desktop asset seam. buildSea.ts
// hashes each embedded file into asset-manifest.json; readVerifiedSeaAsset verifies
// against that one manifest. This test mirrors buildSea's embedding (walk the asset
// roots, build the manifest) WITHOUT running the script, then drives a real SEA read
// of a representative file from every staged desktop/data root. A staged asset that
// the integrity gate rejects (as templates/ did) fails here as a unit test rather
// than only in a live binary.

const REPO_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(REPO_ROOT, 'src', 'desktop', 'data');

type SeaAssetMap = Record<string, string>;

function walk(dir: string, relParts: string[], out: Array<{ rel: string; abs: string }>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, [...relParts, entry.name], out);
    } else if (entry.isFile()) {
      out.push({ rel: [...relParts, entry.name].join('/'), abs });
    }
  }
}

// Build the SEA asset store + manifest the way buildSea.ts does: every file under
// desktop/data embedded at key `desktop/data/<rel>`, and asset-manifest.json mapping
// each key to its sha256 + bytes.
function buildSeaAssets(): SeaAssetMap {
  const files: Array<{ rel: string; abs: string }> = [];
  walk(DATA_DIR, [], files);

  const store: SeaAssetMap = {};
  const manifest: Record<string, { sha256: string; bytes: number }> = {};
  for (const { rel, abs } of files) {
    const key = `desktop/data/${rel}`;
    const buf = readFileSync(abs);
    store[key] = buf.toString('utf-8');
    manifest[key] = {
      sha256: createHash('sha256').update(buf).digest('hex'),
      bytes: buf.byteLength,
    };
  }
  store['asset-manifest.json'] = JSON.stringify(manifest);
  return store;
}

async function importWithSeaAssets(assets: SeaAssetMap): Promise<typeof import('./assets.js')> {
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

function firstXml(subDir: string): string {
  const name = readdirSync(join(DATA_DIR, subDir)).find((f) => f.endsWith('.xml'));
  if (!name) {
    throw new Error(`no .xml file under src/desktop/data/${subDir}`);
  }
  return name;
}

afterEach(() => {
  vi.resetModules();
});

describe('every staged desktop/data asset is readable under SEA', () => {
  // One representative relative asset path per staged root the desktop server reads
  // at runtime. If any root is dropped from the integrity coverage this list catches it.
  const cases: Array<{ label: string; rel: () => string }> = [
    { label: 'templates/', rel: () => `templates/${firstXml('templates')}` },
    {
      label: 'data-visualization-templates-xml/',
      rel: () => `data-visualization-templates-xml/${firstXml('data-visualization-templates-xml')}`,
    },
    { label: 'template-manifests.fixture.json', rel: () => 'template-manifests.fixture.json' },
    { label: 'content-manifest.json', rel: () => 'content-manifest.json' },
    { label: 'corpus.json', rel: () => 'corpus.json' },
    { label: 'twb-example-index.json', rel: () => 'twb-example-index.json' },
    { label: 'workbook-schema-reference.json', rel: () => 'workbook-schema-reference.json' },
    {
      label: 'tableau-desktop-commands-reference.json',
      rel: () => 'tableau-desktop-commands-reference.json',
    },
  ];

  for (const { label, rel } of cases) {
    it(`reads ${label} without tripping the SEA integrity gate`, async () => {
      const assets = buildSeaAssets();
      const { readDataAsset } = await importWithSeaAssets(assets);
      const relPath = rel();
      const expected = assets[`desktop/data/${relPath}`];
      expect(expected, `${relPath} was embedded`).toBeDefined();
      expect(() => readDataAsset(relPath)).not.toThrow();
      expect(readDataAsset(relPath)).toBe(expected);
    });
  }

  it('still fails closed when an embedded asset is not in asset-manifest.json', async () => {
    const assets = buildSeaAssets();
    // A blob file present in the SEA store but absent from the manifest must be rejected.
    assets['desktop/data/templates/__smuggled__.xml'] = '<worksheet/>';
    const { readDataAsset } = await importWithSeaAssets(assets);
    expect(readDataAsset('templates/__smuggled__.xml')).toBeNull();
  });

  it('still fails closed when an embedded asset does not match its manifest hash', async () => {
    const assets = buildSeaAssets();
    const rel = `templates/${firstXml('templates')}`;
    assets[`desktop/data/${rel}`] = `${assets[`desktop/data/${rel}`]}<!-- tampered -->`;
    const { readDataAsset } = await importWithSeaAssets(assets);
    expect(() => readDataAsset(rel)).toThrow(/sha256|integrity/i);
  });
});
