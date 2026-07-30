import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  getSearchDataAppFileTool,
  hasCatastrophicBacktracking,
  SearchDataAppFileResult,
} from './searchDataAppFile.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra().
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

const SAMPLE = [
  'import x from "y";',
  '',
  'function greet(name) {',
  '  console.log("Hello, " + name);',
  '  console.log("Welcome");',
  '}',
  '',
  'greet("world");',
].join('\n');

type SearchArgs = {
  appId: string;
  path: string;
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
};

describe('searchDataAppFileTool', () => {
  let store: FakeWorkspaceStore;
  let appId: string;

  beforeEach(async () => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [{ path: 'src/app.js', content: SAMPLE }],
    });
    appId = workspace.appId;
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getSearchDataAppFileTool(new WebMcpServer());
    expect(tool.name).toBe('search-data-app-file');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it.each(['', 'abc', '0'.repeat(31), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any store lookup',
    async (badAppId) => {
      const tool = getSearchDataAppFileTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(badAppId).success).toBe(false);
    },
  );

  it('finds literal matches with 1-based line numbers and surrounding context', async () => {
    const result = await getToolResult({ appId, path: 'src/app.js', query: 'console.log' });

    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.path).toBe('src/app.js');
    expect(data.totalMatches).toBe(2);
    expect(data.truncated).toBe(false);
    expect(data.matches.map((m) => m.line)).toEqual([4, 5]);
    expect(data.matches[0].text).toContain('Hello');
    // contextLines defaults to 2 — the two lines preceding line 4 are the blank line and the
    // function declaration.
    expect(data.matches[0].before).toEqual(['', 'function greet(name) {']);
    expect(data.matches[0].after.length).toBeGreaterThan(0);
    expect(typeof data.digest).toBe('string');
  });

  it('is case-sensitive by default and case-insensitive when asked', async () => {
    const sensitive = getData(await getToolResult({ appId, path: 'src/app.js', query: 'HELLO' }));
    expect(sensitive.totalMatches).toBe(0);

    const insensitive = getData(
      await getToolResult({ appId, path: 'src/app.js', query: 'HELLO', caseSensitive: false }),
    );
    expect(insensitive.totalMatches).toBe(1);
  });

  it('supports regular-expression matching when isRegex is true', async () => {
    const data = getData(
      await getToolResult({ appId, path: 'src/app.js', query: 'greet\\(', isRegex: true }),
    );
    // Definition line + call line both contain greet(.
    expect(data.totalMatches).toBe(2);
    expect(data.matches.map((m) => m.line).sort((a, b) => a - b)).toEqual([3, 8]);
  });

  it('returns a clean args error for an invalid regular expression', async () => {
    const result = await getToolResult({
      appId,
      path: 'src/app.js',
      query: '(',
      isRegex: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/invalid regular expression/i);
  });

  it('rejects a catastrophic-backtracking regex before it can run', async () => {
    const result = await getToolResult({
      appId,
      path: 'src/app.js',
      query: '(a+)+$',
      isRegex: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/backtracking/i);
    // A literal search for the same text is unaffected by the regex screen.
    const literal = getData(await getToolResult({ appId, path: 'src/app.js', query: '(a+)+$' }));
    expect(literal.totalMatches).toBe(0);
  });

  it('aborts a regex that slips past the static screen but backtracks catastrophically', async () => {
    // `^(a|aa)+$` has star height 1 (no quantifier nested inside another), so the static screen
    // passes it — yet on a run of `a`s that fails the trailing anchor it backtracks exponentially.
    // The worker-thread timeout is the hard backstop. A tiny budget keeps the test fast; the pattern
    // would otherwise run effectively forever on 50 characters.
    expect(hasCatastrophicBacktracking('^(a|aa)+$')).toBe(false);
    vi.stubEnv('DATA_APP_REGEX_TIMEOUT_MS', '50');
    try {
      await store.upsertFiles(SCOPE, appId, [
        { path: 'src/evil.txt', content: `${'a'.repeat(50)}!` },
      ]);
      const result = await getToolResult({
        appId,
        path: 'src/evil.txt',
        query: '^(a|aa)+$',
        isRegex: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toMatch(/time budget|aborted|backtrack/i);
    } finally {
      vi.stubEnv('DATA_APP_REGEX_TIMEOUT_MS', undefined);
    }
  });

  it('does not miscount a phantom trailing line for a file ending in a newline', async () => {
    // Split on /\r?\n/ would otherwise append an empty element for the trailing newline.
    await store.upsertFiles(SCOPE, appId, [{ path: 'src/trailing.js', content: 'a\n\nb\n' }]);
    const data = getData(
      await getToolResult({ appId, path: 'src/trailing.js', query: '^$', isRegex: true }),
    );
    // Only the genuine blank line (line 2) matches — not a phantom line past EOF.
    expect(data.totalMatches).toBe(1);
    expect(data.matches.map((m) => m.line)).toEqual([2]);
  });

  it('truncates to maxMatches while still reporting the true total', async () => {
    const data = getData(
      await getToolResult({ appId, path: 'src/app.js', query: 'console.log', maxMatches: 1 }),
    );
    expect(data.totalMatches).toBe(2);
    expect(data.matches).toHaveLength(1);
    expect(data.truncated).toBe(true);
  });

  it('respects a contextLines of zero', async () => {
    const data = getData(
      await getToolResult({ appId, path: 'src/app.js', query: 'Welcome', contextLines: 0 }),
    );
    expect(data.matches[0].before).toEqual([]);
    expect(data.matches[0].after).toEqual([]);
  });

  it('handles CRLF line endings by splitting on either terminator', async () => {
    await store.upsertFiles(SCOPE, appId, [
      { path: 'src/crlf.js', content: 'alpha\r\nbeta\r\ngamma\r\n' },
    ]);
    const data = getData(await getToolResult({ appId, path: 'src/crlf.js', query: 'beta' }));
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].line).toBe(2);
    expect(data.matches[0].text).toBe('beta');
  });

  it('refuses to search a non-UTF-8 (binary) file', async () => {
    await store.upsertFiles(SCOPE, appId, [
      { path: 'assets/logo.bin', content: new Uint8Array([0xff, 0xfe, 0x00, 0x80]) },
    ]);
    const result = await getToolResult({ appId, path: 'assets/logo.bin', query: 'x' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/not valid UTF-8/i);
  });

  it('returns no matches (not an error) when the query is absent from the file', async () => {
    const data = getData(
      await getToolResult({ appId, path: 'src/app.js', query: 'this string is not present' }),
    );
    expect(data.totalMatches).toBe(0);
    expect(data.matches).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it('never exposes a filesystem path in the result', async () => {
    const result = await getToolResult({ appId, path: 'src/app.js', query: 'greet' });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('/tmp');
    expect(result.content[0].text).not.toMatch(/[A-Za-z]:\\/);
  });

  it('returns an error for a file that does not exist in the workspace', async () => {
    const result = await getToolResult({ appId, path: 'src/missing.js', query: 'x' });
    expect(result.isError).toBe(true);
  });

  it('cannot search a workspace created under a different actor scope', async () => {
    const otherScope = resolveWorkspaceScope({
      transport: 'stdio',
      server: 'https://my-tableau-server.com',
      siteId: 'other-site',
      userId: 'other-user',
    }).unwrap();
    const otherWorkspace = await store.create(otherScope, {
      appName: 'Other App',
      packageId: 'com.example.other',
      template: 'static-html',
      files: [{ path: 'src/app.js', content: 'secret' }],
    });

    const result = await getToolResult({
      appId: otherWorkspace.appId,
      path: 'src/app.js',
      query: 'secret',
    });
    expect(result.isError).toBe(true);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getSearchDataAppFileTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      {
        appId,
        path: 'src/app.js',
        query: 'greet',
        isRegex: false,
        caseSensitive: true,
        contextLines: 2,
        maxMatches: 50,
      },
      extra,
    );

    expect(result.isError).toBe(true);
  });
});

describe('hasCatastrophicBacktracking', () => {
  it.each([
    '(a+)+',
    '(a+)+$',
    '(a*)*',
    '(a+)*',
    '(.*)*',
    '(\\d+)+',
    '([a-z]+)+',
    '((a+))+', // deeply nested is still caught
    '(a{2,})+', // {2,} is unbounded
    '(?:a+)+', // non-capturing group is still nested
    '(a+|b+)+', // alternation of unbounded branches under an unbounded quantifier
    '(\\w+\\.)+', // classic host-like ReDoS shape
  ])('flags nested unbounded quantifiers: %j', (pattern) => {
    expect(hasCatastrophicBacktracking(pattern)).toBe(true);
  });

  it.each([
    'abc',
    'a+',
    '.*',
    '\\d+',
    '[a-z]+',
    '(abc)+', // single unbounded quantifier, star height 1
    '(a|b)+', // alternation without nested quantifiers
    'foo.*bar',
    '(ab)+c',
    'a{2}',
    '(a{2})+', // fixed inner repetition is not the backtracking source
    '(a{2,4})+', // bounded inner repetition
    'console\\.(log|warn|error)',
    '^\\s*//',
    '\\(a+\\)+', // escaped parens are literals, not a group
    '[*+]+', // quantifier chars inside a class are literals
    '(a)?', // optional group
    '(a+)?', // bounded outer quantifier
  ])('allows safe patterns: %j', (pattern) => {
    expect(hasCatastrophicBacktracking(pattern)).toBe(false);
  });
});

async function getToolResult(args: SearchArgs): Promise<CallToolResult> {
  const tool = getSearchDataAppFileTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  // The MCP framework applies schema defaults before invoking the callback; mirror that here so
  // unit tests exercise the same resolved argument shape.
  return await callback(
    {
      appId: args.appId,
      path: args.path,
      query: args.query,
      isRegex: args.isRegex ?? false,
      caseSensitive: args.caseSensitive ?? true,
      contextLines: args.contextLines ?? 2,
      maxMatches: args.maxMatches ?? 50,
    },
    getMockRequestHandlerExtra(),
  );
}

function getData(result: CallToolResult): SearchDataAppFileResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as SearchDataAppFileResult;
}
