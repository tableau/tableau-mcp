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
    const sample = touch('Datasources', '2026.x', 'en_US-US', 'World Indicators.tds');
    const packaged = touch('Datasources', 'My Packaged.tdsx');
    touch('Datasources', 'notes.txt');
    touch('Datasources', '2026.x', 'en_US-US', 'World Indicators.hyper');

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
    touch('Datasources', '2026.x', 'en_US-US', 'World Indicators.tds');
    touch('Datasources', '2026.x', 'en_US-US', 'Sample - Superstore.tds');

    const result = await run({ repositoryLocation: repo }, { nameContains: 'WORLD' });

    expect(result.datasources.map((d) => d.name)).toEqual(['World Indicators']);
  });

  it('does not descend past the depth bound', async () => {
    touch('Datasources', 'a', 'b', 'c', 'd', 'e', 'Too Deep.tds');

    const result = await run({ repositoryLocation: repo });

    expect(result.datasources).toEqual([]);
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
    app: { repositoryLocation?: string },
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
    const result: CallToolResult = await callback({ session: undefined, ...args }, extra);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text) as Result;
  }
});
