import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListSavedDatasourcesTool } from './listSavedDatasources.js';

vi.mock('../../../desktop/session/sessionResolution.js');

type Result = {
  repositoryLocation?: string;
  datasources: Array<{ name: string; path: string; fileType: string; builtInSample: boolean }>;
  message?: string;
};

describe('list-saved-datasources tool', () => {
  let repo: string;

  const touch = (...segments: string[]): string => {
    const file = join(repo, ...segments);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '');
    return file;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    repo = mkdtempSync(join(tmpdir(), 'saved-ds-'));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('is a read-only tool that points at open-file', () => {
    const tool = getListSavedDatasourcesTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-saved-datasources');
    expect(tool.minApiVersion).toBe('0.2.6');
    expect(tool.description).toContain('open-file');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('finds built-in samples in the nested version/locale folder and user sources', async () => {
    const sample = touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.tds');
    const packaged = touch('Datasources', 'My Packaged.tdsx');
    touch('Datasources', 'notes.txt');
    touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.hyper');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources).toEqual([
      { name: 'My Packaged', path: packaged, fileType: 'tdsx', builtInSample: false },
      { name: 'World Indicators', path: sample, fileType: 'tds', builtInSample: true },
    ]);
  });

  it('finds sources in a localized Datasources folder name', async () => {
    const file = touch('Fuentes de datos', 'Ventas.tds');
    touch('Workbooks', 'Not a source.twb');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources.map((d) => d.path)).toEqual([file]);
  });

  it('filters by name case-insensitively', async () => {
    touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.tds');
    touch('Datasources', '2026.1', 'en_US-US', 'Sample - Superstore.tds');

    const result = await run({ repositoryLocation: repo }, { nameContains: 'WORLD' });

    expect(result.datasources.map((d) => d.name)).toEqual(['World Indicators']);
  });

  it('does not descend past the depth bound', async () => {
    touch('Datasources', 'a', 'b', 'c', 'd', 'e', 'Too Deep.tds');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources).toEqual([]);
  });

  it('finds a file exactly at the depth limit', async () => {
    const file = touch('Datasources', 'a', 'b', 'c', 'd', 'At Limit.tds');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources.map((d) => d.path)).toEqual([file]);
  });

  it('only treats files under a <year>.<n> version folder as built-in samples', async () => {
    const user = touch('Datasources', 'Finance', '2024', 'Sales.tds');
    const sample = touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.tds');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources).toEqual([
      { name: 'Sales', path: user, fileType: 'tds', builtInSample: false },
      { name: 'World Indicators', path: sample, fileType: 'tds', builtInSample: true },
    ]);
  });

  it('keeps only the newest version folder of built-in samples', async () => {
    touch('Datasources', '2025.3', 'en_US-US', 'World Indicators.tds');
    touch('Datasources', '2025.3', 'en_US-US', 'Only In Old.tds');
    const newest = touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.tds');
    touch('Datasources', '2026.10', 'en_US-US', 'Ten.tds');

    const result = await run({ repositoryLocation: repo });

    // 2026.10 is newer than 2026.1 (numeric, not lexical, compare).
    expect(result.datasources.map((d) => d.name)).toEqual(['Ten']);
    expect(result.datasources.map((d) => d.path)).not.toContain(newest);
  });

  it('prefers the sample locale folder matching the Desktop locale', async () => {
    touch('Datasources', '2026.1', 'de_DE-DE', 'World Indicators.tds');
    const en = touch('Datasources', '2026.1', 'en_US-US', 'World Indicators.tds');

    const result = await run({ repositoryLocation: repo, locale: 'en_US' });

    expect(result.datasources.map((d) => d.path)).toEqual([en]);
  });

  it('does not scan sibling folders when Datasources exists but is empty', async () => {
    mkdirSync(join(repo, 'Datasources'));
    touch('Other', 'Stray.tds');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources).toEqual([]);
    expect(result.message).toContain('No saved data sources');
  });

  it('returns an empty list with a message when the repository is missing or empty', async () => {
    const missing = await run({ repositoryLocation: join(repo, 'nope') });
    expect(missing.datasources).toEqual([]);
    expect(missing.message).toContain('No saved data sources');

    const empty = await run({ repositoryLocation: repo });
    expect(empty.datasources).toEqual([]);
    expect(empty.message).toContain('No saved data sources');
  });

  it('falls back to TABLEAU_REPOSITORY_DIR when Desktop reports no repository', async () => {
    const file = touch('Datasources', 'Env.tds');
    vi.stubEnv('TABLEAU_REPOSITORY_DIR', repo);

    const result = await run({});

    expect(result.datasources.map((d) => d.path)).toEqual([file]);
  });

  async function run(
    app: { repositoryLocation?: string; locale?: string },
    args: { nameContains?: string } = {},
  ): Promise<Result> {
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(makeExecutorMock({ getApp: vi.fn().mockResolvedValue(Ok(app)) })),
    };
    const tool = getListSavedDatasourcesTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const result: CallToolResult = await callback(
      { session: undefined, nameContains: args.nameContains },
      extra,
    );
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text) as Result;
  }
});
