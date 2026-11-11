import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { loadProviderModule } from './loadProviderModule.js';
import { _setSeaApiForTest } from './sea.js';

const originalExecPath = process.execPath;
const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'load-provider-module-'));
  tempRoots.push(root);
  return root;
}

async function writeModule(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

function setSeaMode(enabled: boolean): void {
  _setSeaApiForTest({
    isSea: () => enabled,
    getAsset: () => {
      throw new Error('not used');
    },
  });
}

afterEach(async () => {
  _setSeaApiForTest(null);
  process.execPath = originalExecPath;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('loadProviderModule', () => {
  it('uses the caller require outside a SEA', async () => {
    const root = await tempRoot();
    const callerEntry = join(root, 'caller', 'entry.cjs');
    await writeModule(
      join(root, 'caller', 'node_modules', 'configured-provider', 'index.js'),
      "module.exports = { source: 'caller' };\n",
    );
    await writeModule(
      join(root, 'sea', 'node_modules', 'configured-provider', 'index.js'),
      "module.exports = { source: 'sea' };\n",
    );
    process.execPath = join(root, 'sea', 'tableau-mcp');
    setSeaMode(false);

    const loaded = loadProviderModule('configured-provider', createRequire(callerEntry));

    expect(loaded).toEqual({ source: 'caller' });
  });

  it('loads an absolute path already resolved by a caller inside a SEA', async () => {
    const root = await tempRoot();
    const providerPath = resolve(root, 'providers', 'feature-gate.cjs');
    await writeModule(providerPath, "module.exports = { source: 'absolute' };\n");
    process.execPath = join(root, 'bin', 'tableau-mcp');
    setSeaMode(true);

    const loaded = loadProviderModule(providerPath, createRequire(join(root, 'caller.cjs')));

    expect(loaded).toEqual({ source: 'absolute' });
  });

  it('resolves a bare SEA provider from the executable directory', async () => {
    const root = await tempRoot();
    const callerEntry = join(root, 'caller', 'entry.cjs');
    process.execPath = join(root, 'bin', 'tableau-mcp');
    await writeModule(
      join(root, 'bin', 'node_modules', 'configured-provider', 'index.js'),
      "module.exports = { source: 'executable' };\n",
    );
    await writeModule(
      join(root, 'caller', 'node_modules', 'configured-provider', 'index.js'),
      "module.exports = { source: 'caller' };\n",
    );
    setSeaMode(true);

    const loaded = loadProviderModule('configured-provider', createRequire(callerEntry));

    expect(loaded).toEqual({ source: 'executable' });
  });

  it('does not fall back to the caller when a SEA module is missing', async () => {
    const root = await tempRoot();
    process.execPath = join(root, 'bin', 'tableau-mcp');
    await writeModule(
      join(root, 'caller', 'node_modules', 'configured-provider', 'index.js'),
      "module.exports = { source: 'caller' };\n",
    );
    setSeaMode(true);

    let thrown: unknown;
    try {
      loadProviderModule('configured-provider', createRequire(join(root, 'caller', 'entry.cjs')));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'MODULE_NOT_FOUND' });
  });
});
