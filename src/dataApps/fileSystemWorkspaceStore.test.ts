import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DataAppValidationNotFoundError,
  DataAppWorkspaceLimitExceededError,
  DataAppWorkspaceNotFoundError,
  UnsafeWorkspacePathError,
} from '../errors/mcpToolError.js';
import {
  FileSystemWorkspaceStore,
  FileSystemWorkspaceStoreOptions,
} from './fileSystemWorkspaceStore.js';
import type { DataAppWorkspace, WorkspaceScope } from './types.js';

const scopeA: WorkspaceScope = {
  server: 'https://tableau.example.com',
  siteId: 'site-1',
  actorId: 'user:alice',
};
const scopeB: WorkspaceScope = {
  server: 'https://tableau.example.com',
  siteId: 'site-1',
  actorId: 'user:bob',
};
const validationId = '1'.repeat(32);
const expiredValidationId = '2'.repeat(32);
const immutableValidationId = '3'.repeat(32);
const malformedOpaqueIds = [
  '../escape',
  '/absolute',
  'with/slash',
  'with\\backslash',
  'with\u0000nul',
  'not-an-opaque-id',
  'A'.repeat(32),
];

let root: string;

function makeStore(
  overrides: Partial<FileSystemWorkspaceStoreOptions> = {},
): FileSystemWorkspaceStore {
  return new FileSystemWorkspaceStore({
    root,
    workspaceTtlMs: 60_000,
    validationTtlMs: 60_000,
    maxFileCount: 10,
    maxFileBytes: 1024,
    maxWorkspaceBytes: 4096,
    ...overrides,
  });
}

async function createApp(
  store: FileSystemWorkspaceStore,
  scope = scopeA,
): Promise<DataAppWorkspace> {
  return store.create(scope, {
    appName: 'My App',
    packageId: 'com.example.app',
    files: [{ path: 'index.html', content: '<html></html>' }],
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dataapp-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FileSystemWorkspaceStore', () => {
  describe('opaque ids', () => {
    it('generates random ids that contain no filesystem path characters', async () => {
      const store = makeStore();
      const a = await createApp(store);
      const b = await createApp(store);

      expect(a.appId).not.toBe(b.appId);
      for (const id of [a.appId, b.appId]) {
        expect(id).toMatch(/^[0-9a-f]+$/);
        expect(id).not.toContain('/');
        expect(id).not.toContain('\\');
        expect(id).not.toContain('.');
        expect(id).not.toContain('..');
      }
    });

    it('does not expose a local path by default', async () => {
      const store = makeStore();
      const app = await createApp(store);
      expect(app.localPath).toBeUndefined();
    });

    it('exposes a local path only when explicitly enabled', async () => {
      const store = makeStore({ exposeLocalPath: true });
      const app = await createApp(store);
      expect(app.localPath).toBeDefined();
      expect(existsSync(app.localPath!)).toBe(true);
    });

    it.each(malformedOpaqueIds)('rejects malformed app id %j before lookup', async (appId) => {
      const store = makeStore();

      await expect(store.get(scopeA, appId)).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
    });

    it.each(malformedOpaqueIds)(
      'rejects malformed validation id %j before lookup or save',
      async (invalidValidationId) => {
        const store = makeStore();
        const app = await createApp(store);

        await expect(store.getValidation(scopeA, invalidValidationId)).rejects.toBeInstanceOf(
          UnsafeWorkspacePathError,
        );
        await expect(
          store.saveValidation(scopeA, {
            validationId: invalidValidationId,
            appId: app.appId,
            bytes: new Uint8Array([1]),
            digest: '',
            sourceDigest: 'src',
          }),
        ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
      },
    );
  });

  describe('actor scoping', () => {
    it('prevents a different actor scope from reading an app', async () => {
      const store = makeStore();
      const app = await createApp(store, scopeA);

      await expect(store.get(scopeB, app.appId)).rejects.toBeInstanceOf(
        DataAppWorkspaceNotFoundError,
      );
    });

    it('prevents a different actor scope from reading a validation', async () => {
      const store = makeStore();
      const app = await createApp(store, scopeA);
      await store.saveValidation(scopeA, {
        validationId,
        appId: app.appId,
        bytes: new Uint8Array([1, 2, 3]),
        digest: '',
        sourceDigest: 'src',
      });

      await expect(store.getValidation(scopeB, validationId)).rejects.toBeInstanceOf(
        DataAppValidationNotFoundError,
      );
      await expect(store.getValidation(scopeA, validationId)).resolves.toMatchObject({
        validationId,
      });
    });
  });

  describe('path containment', () => {
    it.each([
      ['traversal', '../escape.txt'],
      ['nested traversal', 'src/../../escape.txt'],
      ['absolute posix', '/etc/passwd'],
      ['windows drive', 'C:\\Windows\\system32'],
      ['backslash', 'src\\app.js'],
      ['NUL byte', 'src/app\u0000.js'],
      ['empty', ''],
    ])('rejects %s paths on upsert', async (_label, path) => {
      const store = makeStore();
      const app = await createApp(store);

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path, content: 'x' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
    });

    it('rejects reading through a symlink that escapes the workspace', async () => {
      const store = makeStore({ exposeLocalPath: true });
      const app = await createApp(store);

      const outside = join(root, 'outside-secret.txt');
      writeFileSync(outside, 'top secret');
      symlinkSync(outside, join(app.localPath!, 'evil'));

      await expect(store.readFile(scopeA, app.appId, 'evil')).rejects.toBeInstanceOf(
        UnsafeWorkspacePathError,
      );
    });

    it('rejects writing through a symlinked directory', async () => {
      const store = makeStore({ exposeLocalPath: true });
      const app = await createApp(store);

      const outsideDir = join(root, 'outside-dir');
      writeFileSync(join(root, 'placeholder'), '');
      symlinkSync(root, join(app.localPath!, 'link'));

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'link/pwned.txt', content: 'x' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
      expect(existsSync(join(outsideDir, 'pwned.txt'))).toBe(false);
    });
  });

  describe('protected files', () => {
    it('rejects overwriting dataapp.json via ordinary upsert', async () => {
      const store = makeStore();
      const app = await store.create(scopeA, {
        appName: 'App',
        packageId: 'pkg',
        files: [{ path: 'dataapp.json', content: '{"schema":1}' }],
      });

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'dataapp.json', content: '{"evil":1}' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);

      const bytes = await store.readFile(scopeA, app.appId, 'dataapp.json');
      expect(Buffer.from(bytes).toString('utf8')).toBe('{"schema":1}');
    });

    it('rejects a case-variant DataApp.json protected path', async () => {
      const store = makeStore();
      const app = await createApp(store);

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'DataApp.json', content: '{"evil":1}' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);

      expect((await store.listFiles(scopeA, app.appId)).map((file) => file.path)).not.toContain(
        'DataApp.json',
      );
    });
  });

  describe('case-insensitive path identity', () => {
    it('rejects case-colliding paths in one create batch', async () => {
      const store = makeStore();

      await expect(
        store.create(scopeA, {
          appName: 'App',
          packageId: 'pkg',
          files: [
            { path: 'src/App.js', content: 'first' },
            { path: 'src/app.js', content: 'second' },
          ],
        }),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
    });

    it('rejects a case variant of an existing workspace path', async () => {
      const store = makeStore();
      const app = await store.create(scopeA, {
        appName: 'App',
        packageId: 'pkg',
        files: [{ path: 'src/App.js', content: 'original' }],
      });

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'src/app.js', content: 'replacement' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);

      expect(Buffer.from(await store.readFile(scopeA, app.appId, 'src/App.js')).toString()).toBe(
        'original',
      );
    });

    it('rejects reading an existing workspace path with different casing', async () => {
      const store = makeStore();
      const app = await store.create(scopeA, {
        appName: 'App',
        packageId: 'pkg',
        files: [{ path: 'src/App.js', content: 'original' }],
      });

      await expect(store.readFile(scopeA, app.appId, 'src/app.js')).rejects.toBeInstanceOf(
        UnsafeWorkspacePathError,
      );
    });

    it('rejects a case collision introduced through an exposed local path', async () => {
      const store = makeStore({ exposeLocalPath: true });
      const app = await createApp(store);
      mkdirSync(join(app.localPath!, 'src'));
      writeFileSync(join(app.localPath!, 'src', 'App.js'), 'external');

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'src/app.js', content: 'replacement' }]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
    });
  });

  describe('lifecycle and expiry', () => {
    it('makes an expired workspace inaccessible and removable', async () => {
      const store = makeStore({ workspaceTtlMs: -1, exposeLocalPath: true });
      const app = await createApp(store);

      await expect(store.get(scopeA, app.appId)).rejects.toBeInstanceOf(
        DataAppWorkspaceNotFoundError,
      );

      await store.deleteExpired();

      // The workspace directory is gone and it remains inaccessible.
      expect(existsSync(app.localPath!)).toBe(false);
      await expect(store.get(scopeA, app.appId)).rejects.toBeInstanceOf(
        DataAppWorkspaceNotFoundError,
      );
    });

    it('removes expired validations from disk', async () => {
      const store = makeStore({ validationTtlMs: -1 });
      const app = await createApp(store);
      await store.saveValidation(scopeA, {
        validationId: expiredValidationId,
        appId: app.appId,
        bytes: new Uint8Array([9]),
        digest: '',
        sourceDigest: 'src',
      });

      await expect(store.getValidation(scopeA, expiredValidationId)).rejects.toBeInstanceOf(
        DataAppValidationNotFoundError,
      );

      await store.deleteExpired();
      await expect(store.getValidation(scopeA, expiredValidationId)).rejects.toBeInstanceOf(
        DataAppValidationNotFoundError,
      );
    });
  });

  describe('limits', () => {
    it('enforces the per-file byte limit', async () => {
      const app = await createApp(makeStore());
      // A second store over the same root with a tight per-file limit.
      const store = makeStore({ maxFileBytes: 8 });

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'big.txt', content: 'x'.repeat(100) }]),
      ).rejects.toBeInstanceOf(DataAppWorkspaceLimitExceededError);
    });

    it('enforces the file-count limit', async () => {
      const store = makeStore({ maxFileCount: 2 });
      const app = await createApp(store); // starts with index.html

      await expect(
        store.upsertFiles(scopeA, app.appId, [
          { path: 'a.txt', content: 'a' },
          { path: 'b.txt', content: 'b' },
        ]),
      ).rejects.toBeInstanceOf(DataAppWorkspaceLimitExceededError);
    });

    it('enforces the total workspace byte limit', async () => {
      const store = makeStore({ maxFileBytes: 1000, maxWorkspaceBytes: 20 });
      const app = await createApp(store);

      await expect(
        store.upsertFiles(scopeA, app.appId, [{ path: 'a.txt', content: 'x'.repeat(50) }]),
      ).rejects.toBeInstanceOf(DataAppWorkspaceLimitExceededError);
    });

    it('writes nothing when any file in a batch fails validation', async () => {
      const store = makeStore();
      const app = await createApp(store);

      await expect(
        store.upsertFiles(scopeA, app.appId, [
          { path: 'good.txt', content: 'ok' },
          { path: '../bad.txt', content: 'nope' },
        ]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);

      const files = await store.listFiles(scopeA, app.appId);
      expect(files.map((f) => f.path)).not.toContain('good.txt');
    });

    it.each([
      ['ancestor first', ['src', 'src/app.js']],
      ['descendant first', ['src/app.js', 'src']],
    ])('rejects an ancestor collision with %s and writes nothing', async (_label, paths) => {
      const store = makeStore();
      const app = await createApp(store);

      await expect(
        store.upsertFiles(scopeA, app.appId, [
          { path: 'good.txt', content: 'must not be written' },
          ...paths.map((path) => ({ path, content: path })),
        ]),
      ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);

      expect((await store.listFiles(scopeA, app.appId)).map((file) => file.path)).toEqual([
        'index.html',
      ]);
      await expect(store.readFile(scopeA, app.appId, 'good.txt')).rejects.toBeInstanceOf(
        DataAppWorkspaceNotFoundError,
      );
    });
  });

  describe('upsert result', () => {
    it('returns the post-write workspace digest from the same provider operation', async () => {
      const store = makeStore();
      const app = await createApp(store);

      const result = await store.upsertFiles(scopeA, app.appId, [
        { path: 'src/app.js', content: 'console.log(1)' },
        { path: 'src/data.js', content: 'var rows = [];' },
      ]);
      const snapshot = await store.snapshot(scopeA, app.appId);

      expect(result.files).toEqual([
        { path: 'src/app.js', bytes: Buffer.byteLength('console.log(1)') },
        { path: 'src/data.js', bytes: Buffer.byteLength('var rows = [];') },
      ]);
      expect(result.digest).toBe(snapshot.digest);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('validation immutability', () => {
    it('keeps stored validation bytes unchanged after source files change', async () => {
      const store = makeStore();
      const app = await createApp(store);
      await store.upsertFiles(scopeA, app.appId, [{ path: 'data.js', content: 'v1' }]);

      const snapshot = await store.snapshot(scopeA, app.appId);
      const validatedBytes = new Uint8Array([1, 2, 3, 4]);
      await store.saveValidation(scopeA, {
        validationId: immutableValidationId,
        appId: app.appId,
        bytes: validatedBytes,
        digest: '',
        sourceDigest: snapshot.digest,
      });

      // Mutate source after validation.
      await store.upsertFiles(scopeA, app.appId, [{ path: 'data.js', content: 'v2-changed' }]);

      const stored = await store.getValidation(scopeA, immutableValidationId);
      expect(Array.from(stored.bytes)).toEqual([1, 2, 3, 4]);
      expect(stored.sourceDigest).toBe(snapshot.digest);

      const newSnapshot = await store.snapshot(scopeA, app.appId);
      expect(newSnapshot.digest).not.toBe(snapshot.digest);
    });

    it('rejects reusing a validation id and preserves the first immutable bytes', async () => {
      const store = makeStore();
      const app = await createApp(store);
      await store.saveValidation(scopeA, {
        validationId,
        appId: app.appId,
        bytes: new Uint8Array([1, 2, 3]),
        digest: '',
        sourceDigest: 'first-source',
      });

      await expect(
        store.saveValidation(scopeA, {
          validationId,
          appId: app.appId,
          bytes: new Uint8Array([9, 9, 9]),
          digest: '',
          sourceDigest: 'second-source',
        }),
      ).rejects.toMatchObject({ type: 'data-app-validation-already-exists', statusCode: 409 });

      const stored = await store.getValidation(scopeA, validationId);
      expect(Array.from(stored.bytes)).toEqual([1, 2, 3]);
      expect(stored.sourceDigest).toBe('first-source');
    });

    it('produces a deterministic snapshot digest for identical content', async () => {
      const store = makeStore();
      const app1 = await store.create(scopeA, {
        appName: 'A',
        packageId: 'pkg',
        files: [{ path: 'index.html', content: 'same' }],
      });
      const app2 = await store.create(scopeB, {
        appName: 'A',
        packageId: 'pkg',
        files: [{ path: 'index.html', content: 'same' }],
      });

      const s1 = await store.snapshot(scopeA, app1.appId);
      const s2 = await store.snapshot(scopeB, app2.appId);
      expect(s1.digest).toBe(s2.digest);
    });
  });

  describe('atomic writes', () => {
    it('creates files via a temp file then rename (no residual temp files)', async () => {
      const store = makeStore({ exposeLocalPath: true });
      const app = await createApp(store);
      await store.upsertFiles(scopeA, app.appId, [
        { path: 'src/app.js', content: 'console.log(1)' },
      ]);

      const bytes = await store.readFile(scopeA, app.appId, 'src/app.js');
      expect(Buffer.from(bytes).toString('utf8')).toBe('console.log(1)');

      // No leftover *.tmp files.
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        );
      expect(walk(app.localPath!).some((p) => p.endsWith('.tmp'))).toBe(false);
    });
  });
});
