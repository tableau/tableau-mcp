// Low-level access to assets embedded in a Node.js Single Executable Application
// (SEA) blob. Inside a SEA there is no filesystem next to the binary, so bundled
// files are embedded at build time and read at runtime via node:sea. Outside a
// SEA (normal build, tests) getSeaApi() returns an api whose isSea() is false, so
// callers fall back to disk. Asset keys are forward-slash paths relative to the
// build root, e.g. "features.json" or "desktop/data/corpus.json".

export type SeaApi = {
  isSea: () => boolean;
  getAsset: (key: string, encoding?: string) => string | ArrayBuffer;
};

let _seaApi: SeaApi | null | undefined;

function getSeaApi(): SeaApi | null {
  if (_seaApi !== undefined) {
    return _seaApi;
  }
  try {
    // node:sea is only meaningful inside a SEA; require may be unavailable under
    // some test runtimes, so guard it. isSea() returns false outside a SEA.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _seaApi = require('node:sea') as SeaApi;
  } catch {
    _seaApi = null;
  }
  return _seaApi;
}

export function runningAsSea(): boolean {
  try {
    return getSeaApi()?.isSea() ?? false;
  } catch {
    return false;
  }
}

export function readSeaAssetText(key: string): string | null {
  const sea = getSeaApi();
  if (!sea) {
    return null;
  }
  try {
    const asset = sea.getAsset(key, 'utf8');
    return typeof asset === 'string' ? asset : null;
  } catch {
    return null;
  }
}

export function readSeaAssetBytes(key: string): Buffer | null {
  const sea = getSeaApi();
  if (!sea) {
    return null;
  }
  try {
    const asset = sea.getAsset(key);
    return typeof asset === 'string' ? Buffer.from(asset, 'utf-8') : Buffer.from(asset);
  } catch {
    return null;
  }
}

export function _setSeaApiForTest(seaApi: SeaApi | null): void {
  _seaApi = seaApi;
}
