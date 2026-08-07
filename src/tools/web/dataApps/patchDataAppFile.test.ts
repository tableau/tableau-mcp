import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getPatchDataAppFileTool, PatchDataAppFileResult } from './patchDataAppFile.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra() (stdio
// transport, config.server from the stubbed SERVER env var, no authenticated Tableau identity).
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

type Edit = {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  expectedDigest?: string;
};

describe('patchDataAppFileTool', () => {
  let store: FakeWorkspaceStore;
  let appId: string;

  beforeEach(async () => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [
        { path: 'dataapp.json', content: '{}' },
        { path: 'src/app.js', content: 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n' },
      ],
    });
    appId = workspace.appId;
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getPatchDataAppFileTool(new WebMcpServer());
    expect(tool.name).toBe('patch-data-app-file');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it.each(['', 'abc', '0'.repeat(31), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any store lookup',
    async (badAppId) => {
      const tool = getPatchDataAppFileTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(badAppId).success).toBe(false);
    },
  );

  it('applies a single anchor edit and reports matched/bytes/digest', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/app.js', oldString: 'const a = 1;', newString: 'const a = 42;' }],
    });

    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.files).toHaveLength(1);
    expect(data.files[0].path).toBe('src/app.js');
    expect(data.files[0].matched).toBe(1);
    expect(typeof data.digest).toBe('string');
    expect(data.digest.length).toBeGreaterThan(0);

    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toBe(
      'const a = 42;\nconst b = 2;\nconsole.log(a + b);\n',
    );
  });

  it('deletes the matched text when newString is empty', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/app.js', oldString: 'const b = 2;\n', newString: '' }],
    });

    expect(result.isError).toBe(false);
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toBe('const a = 1;\nconsole.log(a + b);\n');
  });

  it('rejects an ambiguous anchor that matches more than one location', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/app.js', oldString: 'const ', newString: 'let ' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/matches 2 locations/);

    // Nothing was written.
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toContain('const a = 1;');
  });

  it('replaces every occurrence when replaceAll is true and reports the count', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/app.js', oldString: 'const ', newString: 'let ', replaceAll: true }],
    });

    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.files[0].matched).toBe(2);
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toBe(
      'let a = 1;\nlet b = 2;\nconsole.log(a + b);\n',
    );
  });

  it('returns an anchor-not-found error when oldString is absent', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/app.js', oldString: 'nonexistent anchor', newString: 'x' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/not found/i);
  });

  it('hints at a line-ending mismatch when the anchor matches except for CRLF', async () => {
    // Store a CRLF file, then patch it with an LF anchor.
    await store.upsertFiles(SCOPE, appId, [
      { path: 'src/crlf.js', content: 'line one\r\nline two\r\n' },
    ]);

    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/crlf.js', oldString: 'line one\nline two\n', newString: 'x' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/line ending/i);
  });

  it('applies multiple edits to the same file in array order against updated content', async () => {
    const result = await getToolResult({
      appId,
      edits: [
        { path: 'src/app.js', oldString: 'const a = 1;', newString: 'const a = 10;' },
        // This anchor only exists AFTER the first edit has been applied.
        { path: 'src/app.js', oldString: 'const a = 10;', newString: 'const a = 100;' },
      ],
    });

    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.files).toHaveLength(1);
    expect(data.files[0].matched).toBe(2);
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toContain('const a = 100;');
  });

  it('writes nothing when any edit in the batch fails (atomic preflight)', async () => {
    const upsertFiles = vi.spyOn(store, 'upsertFiles');
    const result = await getToolResult({
      appId,
      edits: [
        { path: 'src/app.js', oldString: 'const a = 1;', newString: 'const a = 7;' },
        { path: 'src/app.js', oldString: 'this anchor is missing', newString: 'x' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(upsertFiles).not.toHaveBeenCalled();
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toContain('const a = 1;');
  });

  it.each(['dataapp.json', 'DataApp.json', 'DATAAPP.JSON', './dataapp.json'])(
    'refuses to patch the protected manifest path %s before any store call',
    async (path) => {
      const listFiles = vi.spyOn(store, 'listFiles');
      const result = await getToolResult({
        appId,
        edits: [{ path, oldString: '{}', newString: '{"x":1}' }],
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      // The message echoes the caller's path verbatim (any case); the guard matches case-insensitively.
      expect(result.content[0].text.toLowerCase()).toContain('dataapp.json');
      expect(listFiles).not.toHaveBeenCalled();
    },
  );

  it('returns a file-not-found error for a file that is not in the workspace', async () => {
    const result = await getToolResult({
      appId,
      edits: [{ path: 'src/missing.js', oldString: 'x', newString: 'y' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/not found in workspace/i);
  });

  it('rejects a stale expectedDigest and applies edits when the digest matches', async () => {
    // A digest that does not match the current file is rejected without writing.
    const stale = await getToolResult({
      appId,
      edits: [
        {
          path: 'src/app.js',
          oldString: 'const a = 1;',
          newString: 'const a = 5;',
          expectedDigest: 'deadbeef',
        },
      ],
    });
    expect(stale.isError).toBe(true);
    invariant(stale.content[0].type === 'text');
    expect(stale.content[0].text).toMatch(/changed since/i);

    // Read the real per-file digest, then a matching expectedDigest is accepted.
    const readTool = await import('./readDataAppFile.js');
    const readCallback = await Provider.from(
      readTool.getReadDataAppFileTool(new WebMcpServer()).callback,
    );
    const readResult = await readCallback(
      { appId, path: 'src/app.js' },
      getMockRequestHandlerExtra(),
    );
    invariant(readResult.content[0].type === 'text');
    const digest = JSON.parse(readResult.content[0].text).digest as string;

    const ok = await getToolResult({
      appId,
      edits: [
        {
          path: 'src/app.js',
          oldString: 'const a = 1;',
          newString: 'const a = 5;',
          expectedDigest: digest,
        },
      ],
    });
    expect(ok.isError).toBe(false);
  });

  it('refuses to patch a non-UTF-8 (binary) file', async () => {
    await store.upsertFiles(SCOPE, appId, [
      { path: 'assets/logo.bin', content: new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80]) },
    ]);

    const result = await getToolResult({
      appId,
      edits: [{ path: 'assets/logo.bin', oldString: 'x', newString: 'y' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/not valid UTF-8/i);
  });

  it('patches multiple distinct files in a single atomic batch', async () => {
    await store.upsertFiles(SCOPE, appId, [
      { path: 'src/other.js', content: 'export const x = 0;' },
    ]);

    const result = await getToolResult({
      appId,
      edits: [
        { path: 'src/app.js', oldString: 'const a = 1;', newString: 'const a = 9;' },
        { path: 'src/other.js', oldString: 'const x = 0;', newString: 'const x = 1;' },
      ],
    });

    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.files.map((f) => f.path).sort()).toEqual(['src/app.js', 'src/other.js']);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getPatchDataAppFileTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      {
        appId,
        edits: [
          { path: 'src/app.js', oldString: 'const a = 1;', newString: 'x', replaceAll: false },
        ],
      },
      extra,
    );

    expect(result.isError).toBe(true);
  });

  it('returns a not-found error for an unknown appId rather than throwing', async () => {
    const result = await getToolResult({
      appId: '0'.repeat(32),
      edits: [{ path: 'src/app.js', oldString: 'const a = 1;', newString: 'x' }],
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a patch whose projected byte size exceeds the per-file cap without writing', async () => {
    // Cap well below what the replaceAll below would produce. getConfig() reads env fresh, and the
    // FakeWorkspaceStore imposes no size limits, so the tool's own pre-flight guard is what trips —
    // proving the OOM-bounding check happens BEFORE the giant string is materialized.
    vi.stubEnv('DATA_APP_MAX_FILE_BYTES', '64');
    try {
      const upsertFiles = vi.spyOn(store, 'upsertFiles');
      // Seed file is 45 bytes; replacing both 'const ' (6 B each) with 40-byte strings projects to
      // 45 - 2*6 + 2*40 = 113 bytes, over the 64-byte cap.
      const result = await getToolResult({
        appId,
        edits: [
          { path: 'src/app.js', oldString: 'const ', newString: 'x'.repeat(40), replaceAll: true },
        ],
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toMatch(/exceed|limit/i);
      // The oversize replacement was never materialized nor written.
      expect(upsertFiles).not.toHaveBeenCalled();
      const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
      expect(Buffer.from(bytes).toString('utf8')).toBe(
        'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n',
      );
    } finally {
      vi.stubEnv('DATA_APP_MAX_FILE_BYTES', undefined);
    }
  });

  it('applies a patch whose projected byte size is exactly at the per-file cap', async () => {
    // Boundary: guard rejects only when projected > cap, so projected == cap must succeed. The
    // 46-byte seed minus 'const a = 1;' (12 B) plus a 30-byte newString projects to exactly 64.
    vi.stubEnv('DATA_APP_MAX_FILE_BYTES', '64');
    try {
      const newString = 'y'.repeat(30);
      const result = await getToolResult({
        appId,
        edits: [{ path: 'src/app.js', oldString: 'const a = 1;', newString }],
      });

      expect(result.isError).toBe(false);
      const data = getData(result);
      expect(data.files[0].bytes).toBe(64);
    } finally {
      vi.stubEnv('DATA_APP_MAX_FILE_BYTES', undefined);
    }
  });
});

async function getToolResult(args: { appId: string; edits: Edit[] }): Promise<CallToolResult> {
  const tool = getPatchDataAppFileTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  // The MCP framework parses input against the schema before invoking the callback, applying the
  // `replaceAll` default. Mirror that here so unit tests exercise the same resolved shape.
  return await callback(
    { appId: args.appId, edits: args.edits.map((e) => ({ replaceAll: false, ...e })) },
    getMockRequestHandlerExtra(),
  );
}

function getData(result: CallToolResult): PatchDataAppFileResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as PatchDataAppFileResult;
}
