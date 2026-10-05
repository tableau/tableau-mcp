const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
  readdir: mocks.readdir,
  writeFile: mocks.writeFile,
}));

import { buildAssetsMap, MANIFEST_KEY } from './seaAssets.js';

describe('buildAssetsMap', () => {
  beforeEach(() => {
    mocks.existsSync.mockReset().mockReturnValue(true);
    mocks.readFile.mockReset().mockImplementation(async (path: string) => Buffer.from(path));
    mocks.readdir.mockReset();
    mocks.writeFile.mockReset().mockResolvedValue(undefined);
  });

  it('embeds both MCP App HTML bundles in every SEA asset map', async () => {
    const { assets, manifestPath } = await buildAssetsMap([], 'default');

    expect(assets).toEqual(
      expect.objectContaining({
        'features.json': expect.stringMatching(/[\\/]build[\\/]features\.json$/),
        'web/apps/dist/mcp-app.html': expect.stringMatching(
          /[\\/]build[\\/]web[\\/]apps[\\/]dist[\\/]mcp-app\.html$/,
        ),
        'web/apps/dist/hitl-confirm.html': expect.stringMatching(
          /[\\/]build[\\/]web[\\/]apps[\\/]dist[\\/]hitl-confirm\.html$/,
        ),
        [MANIFEST_KEY]: manifestPath,
      }),
    );

    const manifest = JSON.parse(String(mocks.writeFile.mock.calls[0]?.[1]));
    expect(manifest).toEqual(
      expect.objectContaining({
        'web/apps/dist/mcp-app.html': expect.objectContaining({
          sha256: expect.any(String),
          bytes: expect.any(Number),
        }),
        'web/apps/dist/hitl-confirm.html': expect.objectContaining({
          sha256: expect.any(String),
          bytes: expect.any(Number),
        }),
      }),
    );
  });
});
