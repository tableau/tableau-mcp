import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import * as loggerModule from '../../logging/logger.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';
import { desktopToolFactories, episodeToolFactories } from './tools.js';

const state = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('../../desktop/externalApi/discovery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../desktop/externalApi/discovery.js')>()),
  discoverInstances: () => [{ pid: 12345 }],
}));
vi.mock('../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));

// Path arguments that are forwarded to Tableau Desktop on purpose: they name a user file
// that Desktop opens or writes, never a DesktopCache file the server reads or writes.
const FORWARDED_TO_DESKTOP: Record<string, string[]> = {
  'open-file': ['filePath'],
  'save-workbook': ['filePath'],
  'workbook-export-as': ['filePath'],
  'export-worksheet-image': ['filePath'],
  'export-dashboard-image': ['filePath'],
  'export-storyboard-image': ['filePath'],
};

const LAYOUT = { kpis: ['K1'], charts: ['C1'], layoutType: 'auto-grid' };

// Every cache-file argument, with arguments that satisfy the rest of the tool's input.
const CACHE_FILE_CASES: Array<{
  tool: string;
  param: string;
  args: (outside: string) => Record<string, unknown>;
  /** Proof that a real cache file got past containment: reached Desktop, applied, or the tool's own content error. */
  reached: 'executor' | 'apply' | RegExp;
}> = [
  {
    tool: 'apply-workbook',
    param: 'workbookFile',
    reached: 'executor',
    args: (f) => ({ workbookFile: f }),
  },
  {
    tool: 'apply-worksheet',
    param: 'worksheetFile',
    reached: /could not find a top-level <worksheet/,
    args: (f) => ({ worksheetFile: f }),
  },
  {
    tool: 'apply-dashboard',
    param: 'dashboardFile',
    reached: 'executor',
    args: (f) => ({ dashboardName: 'D', dashboardFile: f }),
  },
  {
    tool: 'apply-datasource',
    param: 'datasourceFile',
    reached: 'apply',
    args: (f) => ({ session: '12345', datasourceName: 'ds', datasourceFile: f }),
  },
  {
    tool: 'apply-storyboard',
    param: 'storyboardFile',
    reached: 'executor',
    args: (f) => ({ storyboardName: 'S', storyboardFile: f }),
  },
  {
    tool: 'apply-dashboard-with-viewpoints',
    param: 'dashboardFile',
    reached: 'executor',
    args: (f) => ({ dashboardName: 'D', dashboardFile: f, worksheetNames: ['W'] }),
  },
  {
    tool: 'build-and-apply-dashboard',
    param: 'dashboardFile',
    reached: 'executor',
    args: (f) => ({
      dashboardName: 'D',
      dashboardFile: f,
      workbookFile: INSIDE_PLACEHOLDER,
      layoutSpec: LAYOUT,
      worksheetNames: ['K1', 'C1'],
    }),
  },
  {
    tool: 'build-and-apply-dashboard',
    param: 'workbookFile',
    reached: 'executor',
    args: (f) => ({
      dashboardName: 'D',
      dashboardFile: INSIDE_PLACEHOLDER,
      workbookFile: f,
      layoutSpec: LAYOUT,
      worksheetNames: ['K1', 'C1'],
    }),
  },
  {
    tool: 'list-available-fields',
    param: 'workbookFile',
    reached: 'executor',
    args: (f) => ({ session: '12345', workbookFile: f }),
  },
  {
    tool: 'list-fields',
    param: 'worksheetFile',
    reached: /No fields found/,
    args: (f) => ({ worksheetFile: f }),
  },
  {
    tool: 'add-field',
    param: 'worksheetFile',
    reached: 'executor',
    args: (f) => ({ worksheetFile: f, target: 'rows', columnRef: '[ds].[none:A:nk]' }),
  },
  {
    tool: 'add-field',
    param: 'workbookFile',
    reached: /No worksheet found in XML/,
    args: (f) => ({
      worksheetFile: INSIDE_PLACEHOLDER,
      workbookFile: f,
      target: 'rows',
      columnRef: '[ds].[none:A:nk]',
    }),
  },
  {
    tool: 'remove-field',
    param: 'worksheetFile',
    reached: /No worksheet found in XML/,
    args: (f) => ({ worksheetFile: f, target: 'rows', columnRef: '[ds].[none:A:nk]' }),
  },
  {
    tool: 'resolve-field',
    param: 'workbookFile',
    reached: /"resolution"/,
    args: (f) => ({ workbookFile: f, query: 'Sales' }),
  },
  {
    tool: 'build-and-apply-worksheet',
    param: 'taskSpec.workbookFile',
    reached: /Explicit template binding BLOCKED/,
    args: (f) => ({
      session: '12345',
      taskSpec: { worksheetName: 'W', workbookFile: f, template: 'kpi-text', fields: [] },
    }),
  },
  {
    tool: 'inject-template',
    param: 'workbookFile',
    reached: /Template "t" not found/,
    args: (f) => ({
      workbookFile: f,
      templateName: 't',
      title: 'T',
      sheetType: 'worksheet',
    }),
  },
  {
    tool: 'read-cached-xml',
    param: 'filePath',
    reached: /Read \d+ bytes/,
    args: (f) => ({ filePath: f }),
  },
  {
    tool: 'write-cached-xml',
    param: 'filePath',
    reached: /Wrote \d+ bytes/,
    args: (f) => ({
      session: '12345',
      filePath: f,
      xmlContent: '<workbook>overwritten</workbook>',
    }),
  },
];

// Same tools with worksheetName set: the file must be refused before the sheet-id lookup.
const NAMED_SHEET_CASES = [
  {
    tool: 'add-field',
    param: 'worksheetFile',
    args: (f: string) => ({
      session: '12345',
      worksheetName: 'W',
      worksheetFile: f,
      target: 'rows',
      columnRef: '[ds].[none:A:nk]',
    }),
  },
  {
    tool: 'add-field',
    param: 'workbookFile',
    args: (f: string) => ({
      session: '12345',
      worksheetName: 'W',
      workbookFile: f,
      target: 'rows',
      columnRef: '[ds].[none:A:nk]',
    }),
  },
  {
    tool: 'remove-field',
    param: 'worksheetFile',
    args: (f: string) => ({
      session: '12345',
      worksheetName: 'W',
      worksheetFile: f,
      target: 'rows',
      columnRef: '[ds].[none:A:nk]',
    }),
  },
];

// Filled per test with a real, valid cache file so only the argument under test is hostile.
const INSIDE_PLACEHOLDER = '__inside__';

function pathParams(schema: unknown, prefix: string, out: string[]): void {
  let current = schema as { _def?: { innerType?: unknown; schema?: unknown } } | undefined;
  while (current?._def && (current._def.innerType || current._def.schema)) {
    current = (current._def.innerType ?? current._def.schema) as typeof current;
  }
  if (current instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(current.shape)) {
      const name = `${prefix}.${key}`;
      if (/(file|path)$/i.test(key)) out.push(name.slice(1));
      pathParams(value, name, out);
    }
  }
}

function discoverPathParams(): Map<string, string[]> {
  const server = new DesktopMcpServer();
  const found = new Map<string, string[]>();
  for (const factory of [...desktopToolFactories, ...episodeToolFactories]) {
    const tool = factory(server);
    const names: string[] = [];
    for (const [key, schema] of Object.entries(tool.paramsSchema ?? {})) {
      if (/(file|path)$/i.test(key)) names.push(key);
      pathParams(schema, `.${key}`, names);
    }
    if (names.length > 0) found.set(tool.name, names);
  }
  return found;
}

function text(result: CallToolResult): string {
  const block = result.content[0];
  return block.type === 'text' ? block.text : '';
}

describe('cache-file arguments are contained in the Desktop cache directory', () => {
  let root: string;
  let outside: string;
  let inside: string;
  const OUTSIDE_BYTES = '<workbook name="precious outside file"/>';

  beforeEach(() => {
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    root = mkdtempSync(join(tmpdir(), 'cache-file-guard-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    mkdirSync(join(root, 'outside'));
    outside = join(root, 'outside', 'victim.twb');
    inside = join(state.cacheDir, 'inside.xml');
    writeFileSync(outside, OUTSIDE_BYTES);
    writeFileSync(inside, '<workbook/>');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('classifies every file/path tool argument as contained or forwarded to Desktop', () => {
    const discovered = discoverPathParams();
    const covered = new Map<string, Set<string>>();
    for (const { tool, param } of CACHE_FILE_CASES) {
      covered.set(tool, (covered.get(tool) ?? new Set()).add(param));
    }
    for (const [tool, params] of Object.entries(FORWARDED_TO_DESKTOP)) {
      covered.set(tool, new Set([...(covered.get(tool) ?? []), ...params]));
    }

    const unclassified: string[] = [];
    for (const [tool, params] of discovered) {
      for (const param of params) {
        if (!covered.get(tool)?.has(param)) {
          unclassified.push(`${tool}.${param}`);
        }
      }
    }
    const stale: string[] = [];
    for (const [tool, params] of covered) {
      for (const param of params) {
        if (!discovered.get(tool)?.includes(param)) {
          stale.push(`${tool}.${param}`);
        }
      }
    }

    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  async function invoke(
    { tool: toolName, args }: Pick<(typeof CACHE_FILE_CASES)[number], 'tool' | 'args'>,
    target: string,
    options: { stubDatasourceDesktop?: boolean } = {},
  ): Promise<{
    result: CallToolResult;
    getExecutor: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
  }> {
    const server = new DesktopMcpServer();
    const factory = desktopToolFactories.find((f) => f(server).name === toolName);
    expect(factory).toBeDefined();
    const tool = factory!(server);
    const callback = await Provider.from(tool.callback);
    const apply = vi.fn(async () => Ok({}));
    const getExecutor = vi.fn(() => {
      if (options.stubDatasourceDesktop) {
        return {
          listWorkbookDatasources: async () => Ok({ datasources: [{ id: 'ds1', name: 'ds' }] }),
          applyDatasourceXml: apply,
          applyDatasourceDocument: apply,
        };
      }
      throw new Error('Desktop must not be reached for an outside cache-file argument');
    });
    const extra = { ...getMockRequestHandlerExtra(), getExecutor };
    const raw = JSON.stringify(args(target)).replaceAll(INSIDE_PLACEHOLDER, inside);
    const result = (await (callback as (a: unknown, e: unknown) => Promise<CallToolResult>)(
      JSON.parse(raw),
      extra,
    )) as CallToolResult;
    return { result, getExecutor, apply };
  }

  function cacheListing(): string[] {
    return readdirSync(state.cacheDir).sort();
  }

  function expectRefusedAndUntouched(
    label: string,
    run: Awaited<ReturnType<typeof invoke>>,
    beforeMtime: number,
    listingBefore: string[],
  ): void {
    expect(run.result.isError, label).toBe(true);
    expect(text(run.result)).toMatch(/Security error/);
    expect(text(run.result)).not.toContain('precious outside file');
    expect(run.apply).not.toHaveBeenCalled();
    expect(run.getExecutor, label).not.toHaveBeenCalled();
    expect(readFileSync(outside, 'utf-8')).toBe(OUTSIDE_BYTES);
    expect(statSync(outside).mtimeMs).toBe(beforeMtime);
    expect(cacheListing(), `${label} must not write cache files`).toEqual(listingBefore);
  }

  it.each(CACHE_FILE_CASES)(
    '$tool refuses an outside $param before Desktop and leaves the file untouched',
    async (testCase) => {
      const beforeMtime = statSync(outside).mtimeMs;
      const listingBefore = cacheListing();
      const run = await invoke(testCase, outside);
      expectRefusedAndUntouched(
        `${testCase.tool}.${testCase.param}`,
        run,
        beforeMtime,
        listingBefore,
      );
    },
  );

  it.skipIf(process.platform === 'win32').each(CACHE_FILE_CASES)(
    '$tool refuses a $param symlink inside the cache that points outside',
    async (testCase) => {
      const link = join(state.cacheDir, 'link.twb');
      symlinkSync(outside, link);
      const beforeMtime = statSync(outside).mtimeMs;
      const listingBefore = cacheListing();
      const run = await invoke(testCase, link);
      expectRefusedAndUntouched(
        `${testCase.tool}.${testCase.param}`,
        run,
        beforeMtime,
        listingBefore,
      );
    },
  );

  it.skipIf(process.platform === 'win32').each(NAMED_SHEET_CASES)(
    '$tool refuses a symlinked $param with worksheetName set, without a Desktop call or cache writes',
    async (testCase) => {
      const link = join(state.cacheDir, 'link.twb');
      symlinkSync(outside, link);
      const beforeMtime = statSync(outside).mtimeMs;
      const listingBefore = cacheListing();
      const run = await invoke(testCase, link);
      expectRefusedAndUntouched(
        `${testCase.tool}.${testCase.param}+worksheetName`,
        run,
        beforeMtime,
        listingBefore,
      );
    },
  );

  it.each(CACHE_FILE_CASES)(
    '$tool gets past containment with a real cache file passed as $param',
    async (testCase) => {
      const run = await invoke(testCase, inside, {
        stubDatasourceDesktop: testCase.reached === 'apply',
      });
      expect(text(run.result)).not.toMatch(/Security error/);
      if (testCase.reached === 'executor') {
        expect(run.getExecutor).toHaveBeenCalled();
      } else if (testCase.reached === 'apply') {
        expect(run.apply).toHaveBeenCalled();
        expect(run.result.isError).toBeFalsy();
      } else {
        expect(text(run.result)).toMatch(testCase.reached);
      }
    },
  );

  it('logs the executor failure that proves a real cache file got past containment', async () => {
    const testCase = CACHE_FILE_CASES.find((c) => c.tool === 'apply-workbook')!;

    await invoke(testCase, inside);

    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Tool execution failed',
        level: 'error',
        logger: 'tool',
        data: expect.objectContaining({
          message: 'Desktop must not be reached for an outside cache-file argument',
        }),
      }),
    );
  });
});
