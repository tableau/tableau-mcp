import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorksheetXmlModule from '../../../desktop/commands/workbook/getWorksheetXml.js';
import * as loadWorksheetXmlModule from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import {
  ArgsValidationError,
  GetWorksheetXmlFailedError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRefineWorksheetTool } from './refineWorksheet.js';

vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');

// A single-worksheet fragment shaped like the fetch returns: one nominal dimension CI
// (Region) + one measure CI (SUM Sales), a safe self-closing <computed-sort>, and
// <aggregation> — the ranking-ordered-bar envelope. Declares xmlns:user so the planner's
// user:* filter attributes are in scope.
const SOURCE = `<worksheet name='Sales by Region' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources>
        <datasource caption='Superstore' name='Superstore' />
      </datasources>
      <datasource-dependencies datasource='Superstore'>
        <column datatype='string' name='[Region]' role='dimension' type='nominal' />
        <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
        <column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />
        <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>
      <computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />
      <aggregation value='true' />
    </view>
    <style />
    <panes>
      <pane>
        <view><breakdown value='auto' /></view>
        <mark class='Bar' />
      </pane>
    </panes>
    <rows>[Superstore].[none:Region:nk]</rows>
    <cols>[Superstore].[sum:Sales:qk]</cols>
  </table>
  <simple-id uuid='00000000-0000-0000-0000-000000000001' />
</worksheet>`;

// A source that PLANS fine (one dim, one measure, an anchor) but fails preflight: the extra
// column-instance carries a non-canonical derivation ("Attr"), which the real
// invalid-derivation-string rule rejects as an error. tmcp has no a2td-style
// computed-sort-crash rule, so this exercises the tool's preflight seam against a rule that
// actually exists here. The planner still refuses the nested computed-sort crash form
// directly (covered in the planner test).
const PREFLIGHT_FAIL_SOURCE = SOURCE.replace(
  '</datasource-dependencies>',
  "<column-instance column='[Sales]' derivation='Attr' name='[attr:Sales:xk]' pivot='key' type='ordinal' /></datasource-dependencies>",
);

type GetResult = Awaited<ReturnType<typeof getWorksheetXmlModule.getWorksheetXml>>;
type LoadResult = Awaited<ReturnType<typeof loadWorksheetXmlModule.loadWorksheetXml>>;
type ErrOf<R> = R extends Err<infer E> ? E : never;

interface MockOpts {
  source?: string;
  fetchErr?: ErrOf<GetResult>;
  applyErr?: ErrOf<LoadResult>;
  /** Readback: 'echo' (the applied XML, default) or 'source' (Tableau silently dropped it). */
  readback?: 'echo' | 'source';
}

const getMock = (): ReturnType<typeof vi.mocked<typeof getWorksheetXmlModule.getWorksheetXml>> =>
  vi.mocked(getWorksheetXmlModule.getWorksheetXml);
const loadMock = (): ReturnType<typeof vi.mocked<typeof loadWorksheetXmlModule.loadWorksheetXml>> =>
  vi.mocked(loadWorksheetXmlModule.loadWorksheetXml);

function setupMocks(opts: MockOpts = {}): { applied: () => string | null } {
  const source = opts.source ?? SOURCE;
  let lastApplied: string | null = null;
  let getCalls = 0;

  getMock().mockImplementation(async (): Promise<GetResult> => {
    getCalls += 1;
    if (getCalls === 1) {
      // The fetch.
      return (opts.fetchErr ? Err(opts.fetchErr) : Ok(source)) as GetResult;
    }
    // The readback.
    return (opts.readback === 'source' ? Ok(source) : Ok(lastApplied ?? source)) as GetResult;
  });

  loadMock().mockImplementation(async ({ xml }: { xml: string }): Promise<LoadResult> => {
    lastApplied = xml;
    return (opts.applyErr ? Err(opts.applyErr) : Ok.EMPTY) as LoadResult;
  });

  return { applied: () => lastApplied };
}

describe('refineWorksheetTool — instance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a tool instance with the expected properties', () => {
    const tool = getRefineWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('refine-worksheet');
    expect(tool.description).toContain('Refine a worksheet');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      operation: expect.any(Object),
      topN: expect.any(Object),
      sortDirection: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Refine Worksheet',
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
});

describe('refineWorksheetTool — top_n happy path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches, patches, applies once, and confirms the Top-N filter on readback', async () => {
    const { applied } = setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(parsed.message).toMatch(/Applied top_n/);

    // Applied exactly once (never a second apply).
    expect(loadMock()).toHaveBeenCalledTimes(1);

    // The applied XML carries the native Top-N filter + a slices entry.
    const out = applied()!;
    expect(out).toMatch(/function='end'\s+end='top'\s+count='5'/);
    expect(out).toContain('<slices><column>[Superstore].[none:Region:nk]</column></slices>');
  });
});

describe('refineWorksheetTool — sort_direction happy path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips the computed-sort direction and confirms it on readback', async () => {
    const { applied } = setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'sort_direction',
      sortDirection: { direction: 'ASC' },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.message).toMatch(/Applied sort_direction/);
    expect(loadMock()).toHaveBeenCalledTimes(1);
    expect(applied()!).toContain("direction='ASC'");
    expect(applied()!).not.toContain("direction='DESC'");
  });
});

describe('refineWorksheetTool — refusals and errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('errors on a missing worksheetName and never touches Tableau', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: '',
      operation: 'top_n',
      topN: { n: 5 },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('worksheetName is required.').message,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('errors when the worksheet cannot be fetched (not found) — no apply', async () => {
    const fetchErr = {
      type: 'get-worksheet-xml-error' as const,
      error: { type: 'no-worksheet-found' as const, message: 'No worksheet found for Ghost.' },
    };
    setupMocks({ fetchErr });
    const result = await getToolResult({
      worksheetName: 'Ghost',
      operation: 'top_n',
      topN: { n: 5 },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetWorksheetXmlFailedError(fetchErr.error).message);
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('refuses on preflight failure and NEVER applies', async () => {
    setupMocks({ source: PREFLIGHT_FAIL_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/preflight validation failed/);
    expect(parsed.reason).toMatch(/invalid-derivation-string/);
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('errors when the single apply fails, with no second apply', async () => {
    const applyErr = {
      type: 'load-worksheet-xml-error' as const,
      error: { type: 'load-rejected' as const, message: 'rejected' },
    };
    setupMocks({ applyErr });
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new WorksheetXmlLoadFailedError(applyErr.error).message);
    expect(loadMock()).toHaveBeenCalledTimes(1);
  });

  it('refuses when readback does not confirm the expected node (applied once)', async () => {
    // Apply succeeds, but readback returns the un-patched source (Tableau silently
    // dropped the filter) → confirmation fails → refuse, no retry.
    setupMocks({ readback: 'source' });
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/readback did not contain/);
    expect(loadMock()).toHaveBeenCalledTimes(1);
  });

  it('refuses an out-of-range n (kill criterion surfaced through the tool)', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 999 },
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/between 1 and 50/);
    expect(loadMock()).not.toHaveBeenCalled();
  });
});

const successSchema = z.object({
  refined: z.literal(true),
  operation: z.enum(['top_n', 'sort_direction']),
  worksheetName: z.string(),
  message: z.string(),
});

const refusalSchema = z.object({
  refined: z.literal(false),
  operation: z.enum(['top_n', 'sort_direction']),
  worksheetName: z.string(),
  reason: z.string(),
});

async function getToolResult({
  worksheetName,
  operation,
  topN,
  sortDirection,
  session = '12345',
}: {
  worksheetName: string;
  operation: 'top_n' | 'sort_direction';
  topN?: { n: number; end?: 'top' | 'bottom' };
  sortDirection?: { direction: 'ASC' | 'DESC' };
  session?: string;
}): Promise<CallToolResult> {
  const tool = getRefineWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({}),
  };

  return await callback({ session, worksheetName, operation, topN, sortDirection }, extra);
}
