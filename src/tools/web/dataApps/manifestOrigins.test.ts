import type { WorkspaceScope } from '../../../dataApps/types.js';
import { allowedOriginsParam, updateManifestAllowedOrigins } from './manifestOrigins.js';
import { buildDataAppManifest, DATA_APP_MANIFEST_PATH } from './templates.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

const scope: WorkspaceScope = {
  server: 'https://tableau.example.com',
  siteId: 'site-1',
  actorId: 'user:alice',
};

function manifestJson(allowedOrigins?: string): string {
  return `${JSON.stringify(
    buildDataAppManifest({
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'live-extension',
      datasources: [
        {
          luid: 'ds-luid-1',
          contentUrl: 'sales/Sales',
          name: 'Sales',
          sqlproxyName: 'sqlproxy.abc123',
          host: 'tableau.example.com',
          port: '443',
          field: { fieldName: 'amount', caption: 'Amount', dataType: 'REAL' },
        },
      ],
      allowedOrigins,
    }),
    null,
    2,
  )}\n`;
}

describe('allowedOriginsParam', () => {
  it('is optional — undefined when absent', () => {
    expect(allowedOriginsParam.parse(undefined)).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(allowedOriginsParam.parse('  https://api.example.com  ')).toBe(
      'https://api.example.com',
    );
  });

  it('trims a whitespace-only value down to an empty string (the clear signal)', () => {
    expect(allowedOriginsParam.parse('   ')).toBe('');
  });

  it('rejects a value that exceeds the length cap after trimming', () => {
    expect(allowedOriginsParam.safeParse('x'.repeat(2001)).success).toBe(false);
    expect(allowedOriginsParam.safeParse('x'.repeat(2000)).success).toBe(true);
  });
});

describe('updateManifestAllowedOrigins', () => {
  async function seed(
    allowedOrigins?: string,
  ): Promise<{ store: FakeWorkspaceStore; appId: string }> {
    const store = new FakeWorkspaceStore();
    const ws = await store.create(scope, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'live-extension',
      files: [{ path: DATA_APP_MANIFEST_PATH, content: manifestJson(allowedOrigins) }],
    });
    return { store, appId: ws.appId };
  }

  it('sets the origin while preserving every other manifest field, byte-for-byte', async () => {
    const { store, appId } = await seed();

    await updateManifestAllowedOrigins(store, scope, appId, 'https://api.example.com');

    const bytes = await store.readFile(scope, appId, DATA_APP_MANIFEST_PATH);
    expect(Buffer.from(bytes).toString('utf8')).toBe(manifestJson('https://api.example.com'));
  });

  it('clears the origin key when given a blank string', async () => {
    const { store, appId } = await seed('https://api.example.com');

    await updateManifestAllowedOrigins(store, scope, appId, '   ');

    const bytes = await store.readFile(scope, appId, DATA_APP_MANIFEST_PATH);
    // Blank trims away in buildDataAppManifest, so the key is omitted — identical to a no-origins app.
    expect(Buffer.from(bytes).toString('utf8')).toBe(manifestJson());
  });

  it('writes through the sanctioned manifest writer, not ordinary upsertFiles', async () => {
    const { store, appId } = await seed();
    const writeManifest = vi.spyOn(store, 'writeManifest');
    const upsertFiles = vi.spyOn(store, 'upsertFiles');

    await updateManifestAllowedOrigins(store, scope, appId, 'https://api.example.com');

    expect(writeManifest).toHaveBeenCalledTimes(1);
    expect(upsertFiles).not.toHaveBeenCalled();
  });
});
