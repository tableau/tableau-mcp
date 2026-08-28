import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import { planRoundStackedBar } from '../../../../desktop/refine/roundStackedBar.js';
import * as applyRoundedStackedBarModule from '../../../../desktop/wrappers/applyRoundedStackedBar.js';
import * as getWorksheetXmlModule from '../../../../desktop/wrappers/getWorksheetXml.js';
import * as loadWorksheetXmlModule from '../../../../desktop/wrappers/loadWorksheetXml.js';
import {
  ArgsValidationError,
  GetWorksheetXmlFailedError,
  WorksheetXmlLoadFailedError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getRefineWorksheetTool } from './refineWorksheet.js';

vi.mock('../../../../desktop/wrappers/getWorksheetXml.js');
vi.mock('../../../../desktop/wrappers/loadWorksheetXml.js');
vi.mock('../../../../desktop/wrappers/applyRoundedStackedBar.js');

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

const ROUND_STACKED_SOURCE = `<worksheet name='Profit by Category' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources><datasource caption='Superstore' name='Superstore' /></datasources>
      <datasource-dependencies datasource='Superstore'>
        <column caption='Category' datatype='string' name='[Category]' role='dimension' type='nominal' />
        <column caption='Segment' datatype='string' name='[Segment]' role='dimension' type='nominal' />
        <column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />
        <column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />
        <column-instance column='[Segment]' derivation='None' name='[none:Segment:nk]' pivot='key' type='nominal' />
        <column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>
      <computed-sort column='[Superstore].[none:Category:nk]' direction='DESC' using='[Superstore].[sum:Profit:qk]' />
      <aggregation value='true' />
    </view>
    <style><style-rule element='zeroline'><format attr='line-visibility' value='off' /></style-rule></style>
    <panes><pane>
      <view><breakdown value='auto' /></view>
      <mark class='Bar' />
      <encodings><color column='[Superstore].[none:Segment:nk]' /></encodings>
    </pane></panes>
    <rows>[Superstore].[sum:Profit:qk]</rows>
    <cols>[Superstore].[none:Category:nk]</cols>
  </table>
  <simple-id uuid='{B157D4FA-12A0-495E-BEC4-3572B3567648}' />
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

const SORT_BY_FIELD_SOURCE = SOURCE.replace(
  /<datasource-dependencies datasource='Superstore'>[\s\S]*?<\/datasource-dependencies>/,
  `<datasource-dependencies datasource='Superstore'>
        <column caption='Line Item' datatype='string' name='[line_item]' role='dimension' type='nominal' />
        <column caption='display_order' datatype='integer' name='[display_order]' role='measure' type='quantitative' />
        <column-instance column='[line_item]' derivation='None' name='[none:line_item:nk]' pivot='key' type='nominal' />
        <column-instance column='[display_order]' derivation='Sum' name='[sum:display_order:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>`,
)
  .replaceAll('[Superstore].[none:Region:nk]', '[Superstore].[none:line_item:nk]')
  .replaceAll('[Superstore].[sum:Sales:qk]', '[Superstore].[sum:display_order:qk]')
  .replace(/<computed-sort[^>]*\/>/, '');

const AMP_WORKSHEET_SOURCE = SOURCE.replace(
  "name='Sales by Region'",
  "name='P&amp;L Waterfall: Revenue to Net Income'",
);

const ANGLE_QUOTE_WORKSHEET_SOURCE = SOURCE.replace(
  "name='Sales by Region'",
  "name='Revenue &lt; &quot;Gross&quot;'",
);

type GetResult = Awaited<ReturnType<typeof getWorksheetXmlModule.getWorksheetXml>>;
type LoadResult = Awaited<ReturnType<typeof loadWorksheetXmlModule.loadWorksheetXml>>;
type ErrOf<R> = R extends Err<infer E> ? E : never;

interface MockOpts {
  source?: string;
  fetchErr?: ErrOf<GetResult>;
  applyErr?: ErrOf<LoadResult>;
  /**
   * Readback shape:
   *  - 'echo' (default): every readback poll immediately returns the applied XML.
   *  - 'source': the async apply NEVER settles within the poll budget — every readback
   *    poll keeps returning the un-patched source (Tableau silently dropped the change).
   *  - a number N: simulates the confirmed live race — the apply landed, but the FIRST
   *    readback(s) run before it settles. Polls 1..N-1 return the pre-apply source; poll N
   *    onward returns the applied XML.
   */
  readback?: 'echo' | 'source' | number;
  /**
   * When set, EVERY readback poll returns this fixed XML instead of the applied/source XML.
   * Models Desktop landing the node but with a different direction than requested (the sort
   * node is present, so it is not an async-settle miss — the confirm just never matches).
   */
  readbackXml?: string;
}

const getMock = (): ReturnType<typeof vi.mocked<typeof getWorksheetXmlModule.getWorksheetXml>> =>
  vi.mocked(getWorksheetXmlModule.getWorksheetXml);
const loadMock = (): ReturnType<typeof vi.mocked<typeof loadWorksheetXmlModule.loadWorksheetXml>> =>
  vi.mocked(loadWorksheetXmlModule.loadWorksheetXml);
const roundedApplyMock = (): ReturnType<
  typeof vi.mocked<typeof applyRoundedStackedBarModule.applyRoundedStackedBar>
> => vi.mocked(applyRoundedStackedBarModule.applyRoundedStackedBar);

// The get-worksheet-xml result now carries the resolved display name; mirror how the live
// resolver returns it — the decoded <worksheet name> attribute, not the XML-escaped form.
function sourceName(xml: string): string {
  const raw = xml.match(/<worksheet name='([^']*)'/)?.[1] ?? '';
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function setupMocks(opts: MockOpts = {}): { applied: () => string | null } {
  const source = opts.source ?? SOURCE;
  const name = sourceName(source);
  let lastApplied: string | null = null;
  let getCalls = 0;
  let readbackCalls = 0;

  getMock().mockImplementation(async (): Promise<GetResult> => {
    getCalls += 1;
    if (getCalls === 1) {
      // The fetch.
      return (opts.fetchErr ? Err(opts.fetchErr) : Ok({ xml: source, name })) as GetResult;
    }
    // A readback poll.
    readbackCalls += 1;
    if (opts.readbackXml !== undefined) return Ok({ xml: opts.readbackXml, name }) as GetResult;
    if (opts.readback === 'source') return Ok({ xml: source, name }) as GetResult;
    if (typeof opts.readback === 'number') {
      return (
        readbackCalls < opts.readback
          ? Ok({ xml: source, name })
          : Ok({ xml: lastApplied ?? source, name })
      ) as GetResult;
    }
    return Ok({ xml: lastApplied ?? source, name }) as GetResult;
  });

  loadMock().mockImplementation(async ({ xml }: { xml: string }): Promise<LoadResult> => {
    lastApplied = xml;
    return (opts.applyErr ? Err(opts.applyErr) : Ok.EMPTY) as LoadResult;
  });

  return { applied: () => lastApplied };
}

describe('refineWorksheetTool — instance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a tool instance with the expected properties', async () => {
    const tool = getRefineWorksheetTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    expect(tool.name).toBe('refine-worksheet');
    expect(tool.description).toContain('mark type');
    expect(paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      operation: expect.any(Object),
      topN: expect.any(Object),
      sortDirection: expect.any(Object),
      targetField: expect.any(Object),
      sortByField: expect.any(Object),
      direction: expect.any(Object),
      markType: expect.any(Object),
      preset: expect.any(Object),
    });
    expect(paramsSchema.operation.safeParse('round_stacked_bar').success).toBe(true);
    expect(paramsSchema.preset.safeParse('subtle').success).toBe(true);
    expect(paramsSchema.preset.safeParse('strong').success).toBe(false);
    expect(paramsSchema.sortDirection.description).toContain('numeric DESC=largest');
    expect(paramsSchema.direction.description).toContain('numeric desc=largest');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
});

describe('refineWorksheetTool — round_stacked_bar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a missing subtle preset without reading or writing Tableau', async () => {
    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(refusalSchema.parse(JSON.parse(result.content[0].text))).toMatchObject({
      refined: false,
      operation: 'round_stacked_bar',
      reason: expect.stringMatching(/preset.*subtle/i),
    });
    expect(getMock()).not.toHaveBeenCalled();
    expect(roundedApplyMock()).not.toHaveBeenCalled();
  });

  it('refuses a non-subtle preset without reading or writing Tableau', async () => {
    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'strong' as never,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(refusalSchema.parse(JSON.parse(result.content[0].text)).reason).toMatch(
      /preset.*subtle/i,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(roundedApplyMock()).not.toHaveBeenCalled();
  });

  it('refuses an unsupported chart shape before applying', async () => {
    setupMocks({ source: SOURCE });

    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/stacked|segment|color/i);
    expect(roundedApplyMock()).not.toHaveBeenCalled();
  });

  it('reports the complete programmatic readback and the remaining visual and disclosure work', async () => {
    setupMocks({ source: ROUND_STACKED_SOURCE });
    roundedApplyMock().mockResolvedValue({
      state: 'applied',
      mutation: 'sent',
      retrySafe: false,
      worksheet: {
        id: '{B157D4FA-12A0-495E-BEC4-3572B3567648}',
        name: 'Profit by Category',
      },
      baseline: {
        worksheetId: '{B157D4FA-12A0-495E-BEC4-3572B3567648}',
        groups: [
          { category: 'Furniture', segment: 'Consumer', value: 10 },
          { category: 'Furniture', segment: 'Corporate', value: 5 },
        ],
        segmentOrderFromZero: ['Corporate', 'Consumer'],
        expectedVertexRows: 24,
        categoryVisualOrder: 'live-only',
      },
    });

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed).toMatchObject({
      refined: true,
      operation: 'round_stacked_bar',
      verification: {
        helperFields: 18,
        summaryGroups: 2,
        summaryRows: 24,
      },
    });
    expect(parsed.message).toContain(
      'Programmatic readback confirmed the 18-field helper structure, 2 summary groups, 24 summary rows, the worksheet caption and alt text.',
    );
    expect(parsed.message).toContain('Manually inspect rendered stack order.');
    expect(parsed.message).toContain(
      'Tableau Data Guide and View Data may show internal polygon helper fields.',
    );
    expect(roundedApplyMock()).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorksheetXml: ROUND_STACKED_SOURCE,
        intendedWorksheetXml: expect.stringContaining("<mark class='Polygon' />"),
        focus: { navigate: 'artifact', sheetName: 'Profit by Category' },
      }),
    );
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('reports an already-rounded sheet as a truthful no-op without live claims', async () => {
    const compiled = planRoundStackedBar(ROUND_STACKED_SOURCE, { preset: 'subtle' });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    setupMocks({ source: compiled.xml });

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const raw = JSON.parse(result.content[0].text);
    const parsed = refusalSchema.parse(raw);
    expect(parsed).toMatchObject({ refined: false, operation: 'round_stacked_bar' });
    expect(parsed.reason).toMatch(/already.*rounded/i);
    expect(parsed.reason).not.toMatch(/verif|caption|alt text|data guide|view data|visual/i);
    expect(raw).not.toHaveProperty('verification');
    expect(roundedApplyMock()).not.toHaveBeenCalled();
  });

  it('reports caption suppression instead of claiming a visible caption', async () => {
    const source = ROUND_STACKED_SOURCE.replace(
      '  <table>',
      "  <layout-options export-no-caption='true' />\n  <table>",
    );
    setupMocks({ source });
    roundedApplyMock().mockResolvedValue({
      state: 'applied',
      mutation: 'sent',
      retrySafe: false,
      worksheet: {
        id: '{B157D4FA-12A0-495E-BEC4-3572B3567648}',
        name: 'Profit by Category',
      },
      baseline: {
        worksheetId: '{B157D4FA-12A0-495E-BEC4-3572B3567648}',
        groups: [
          { category: 'Furniture', segment: 'Consumer', value: 10 },
          { category: 'Furniture', segment: 'Corporate', value: 5 },
        ],
        segmentOrderFromZero: ['Corporate', 'Consumer'],
        expectedVertexRows: 24,
        categoryVisualOrder: 'live-only',
      },
    });

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.message).toContain(
      'Programmatic readback confirmed the 18-field helper structure, 2 summary groups, 24 summary rows, preserved caption suppression state and alt text.',
    );
    expect(parsed.message).not.toContain('the worksheet caption');
    expect(parsed.message).toContain('Manually inspect rendered stack order.');
    expect(parsed.message).toContain(
      'Tableau Data Guide and View Data may show internal polygon helper fields.',
    );
  });

  it('returns a normal refusal when strict pre-write evidence blocks the conversion', async () => {
    setupMocks({ source: ROUND_STACKED_SOURCE });
    roundedApplyMock().mockResolvedValue({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'seed-preflight',
      message: 'Each Category×Segment group needs two distinct raw seed values.',
    });

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const raw = JSON.parse(result.content[0].text);
    expect(refusalSchema.parse(raw)).toMatchObject({
      refined: false,
      reason: expect.stringMatching(/seed-preflight.*two distinct raw seed values/i),
    });
    expect(raw).not.toHaveProperty('verification');
    expect(JSON.stringify(raw)).not.toMatch(/worksheet caption|alt text|view data/i);
  });

  it('maps any unknown post-write state to a typed do-not-retry incomplete result', async () => {
    setupMocks({ source: ROUND_STACKED_SOURCE });
    roundedApplyMock().mockResolvedValue({
      state: 'unknown',
      mutation: 'sent',
      retrySafe: false,
      stage: 'verification',
      message: 'Strict readback did not settle.',
    });

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const raw = JSON.parse(result.content[0].text);
    expect(raw).toMatchObject({
      refined: 'unknown',
      operation: 'round_stacked_bar',
      retrySafe: false,
      stage: 'verification',
      guidance: expect.stringMatching(/inspect.*do not retry/i),
    });
    expect(raw).not.toHaveProperty('verification');
    expect(JSON.stringify(raw)).not.toMatch(/worksheet caption|alt text|view data/i);
  });

  it('treats an unexpected wrapper throw as unknown and unsafe to retry', async () => {
    setupMocks({ source: ROUND_STACKED_SOURCE });
    roundedApplyMock().mockRejectedValue(new Error('unexpected wrapper failure'));

    const result = await getToolResult({
      worksheetName: 'Profit by Category',
      operation: 'round_stacked_bar',
      preset: 'subtle',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const raw = JSON.parse(result.content[0].text);
    expect(raw).toMatchObject({
      refined: 'unknown',
      operation: 'round_stacked_bar',
      retrySafe: false,
      stage: 'wrapper',
      guidance: expect.stringMatching(/inspect.*do not retry/i),
    });
    expect(raw).not.toHaveProperty('verification');
    expect(JSON.stringify(raw)).not.toMatch(/worksheet caption|alt text|view data/i);
  });
});

describe('refineWorksheetTool — mark_type', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches once, applies the requested mark type once, and confirms it on readback', async () => {
    const { applied } = setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'mark_type',
      markType: 'area',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed).toMatchObject({ refined: true, operation: 'mark_type' });
    expect(applied()!).toContain("<mark class='Area' />");
    expect(getMock()).toHaveBeenCalledTimes(2);
    expect(loadMock()).toHaveBeenCalledTimes(1);
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ requireExistingSheet: true }),
    );
  });

  it('refuses a multi-pane worksheet without applying', async () => {
    const source = SOURCE.replace(
      '</panes>',
      "  <pane><view><breakdown value='auto' /></view><mark class='Line' /></pane>\n    </panes>",
    );
    setupMocks({ source });

    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'mark_type',
      markType: 'area',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/exactly one pane/i);
    expect(loadMock()).not.toHaveBeenCalled();
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

    // Refine edits a sheet it already fetched, so it applies via the per-sheet replace-by-id
    // route (requireExistingSheet), never the whole-workbook upsert/create path.
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ requireExistingSheet: true }),
    );

    // The applied XML carries the native Top-N filter + a slices entry.
    const out = applied()!;
    expect(out).toMatch(/function='end'\s+end='top'\s+count='5'/);
    expect(out).toContain('<slices><column>[Superstore].[none:Region:nk]</column></slices>');
  });

  it('reads back by the fragment simple-id, not the display name', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });

    expect(result.isError).toBe(false);
    // The initial fetch is by the caller's display name...
    expect(getMock().mock.calls[0]![0]).toMatchObject({ worksheetName: 'Sales by Region' });
    // ...but the readback targets the sheet's stable simple-id, so a rename between the fetch
    // and the readback can't make it miss.
    expect(getMock().mock.calls[1]![0]).toMatchObject({
      worksheetName: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('refines an ampersand-titled worksheet by literal name', async () => {
    setupMocks({ source: AMP_WORKSHEET_SOURCE });
    const result = await getToolResult({
      worksheetName: 'P&L Waterfall: Revenue to Net Income',
      operation: 'top_n',
      topN: { n: 5 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(parsed.worksheetName).toBe('P&L Waterfall: Revenue to Net Income');
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'P&L Waterfall: Revenue to Net Income' }),
    );
  });

  it('normalizes escaped ampersand input and still refines the literal worksheet', async () => {
    setupMocks({ source: AMP_WORKSHEET_SOURCE });
    const result = await getToolResult({
      worksheetName: 'P&amp;L Waterfall: Revenue to Net Income',
      operation: 'top_n',
      topN: { n: 5 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(parsed.worksheetName).toBe('P&L Waterfall: Revenue to Net Income');
    expect(parsed.message).toContain('"P&L Waterfall: Revenue to Net Income"');
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'P&L Waterfall: Revenue to Net Income' }),
    );
  });

  it('refines a worksheet whose title contains angle brackets and quotes', async () => {
    setupMocks({ source: ANGLE_QUOTE_WORKSHEET_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Revenue < "Gross"',
      operation: 'top_n',
      topN: { n: 5 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(parsed.worksheetName).toBe('Revenue < "Gross"');
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Revenue < "Gross"' }),
    );
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
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ requireExistingSheet: true }),
    );
    expect(applied()!).toContain("direction='ASC'");
    expect(applied()!).not.toContain("direction='DESC'");
  });
});

describe('refineWorksheetTool — sort_by_field happy path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies a computed-sort by field caption and confirms column/using/direction on readback', async () => {
    const { applied } = setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      targetField: 'Line Item',
      sortByField: 'display_order',
      direction: 'asc',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.message).toMatch(/Applied sort_by_field/);
    expect(loadMock()).toHaveBeenCalledTimes(1);
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ requireExistingSheet: true }),
    );
    expect(applied()!).toContain(
      "<computed-sort column='[Superstore].[none:line_item:nk]' direction='ASC' using='[Superstore].[sum:display_order:qk]' />",
    );
  });

  it('defaults sort_by_field direction to ascending', async () => {
    const { applied } = setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      targetField: 'Line Item',
      sortByField: 'display_order',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(applied()!).toContain("direction='ASC'");
  });

  it('sorts by field with no targetField (the observed crash call) — auto-detects the axis', async () => {
    // The exact call from the bug report: sortByField + direction, NO targetField. It used
    // to throw TypeError in normalizeCaption; it must now resolve to a non-error result.
    const { applied } = setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      sortByField: 'display_order',
      direction: 'desc',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(applied()!).toContain(
      "<computed-sort column='[Superstore].[none:line_item:nk]' direction='DESC' using='[Superstore].[sum:display_order:qk]' />",
    );
  });

  it('honors nested sortDirection.direction=DESC on sort_by_field (not a silent ASC default)', async () => {
    // e5 defect 1: the model's natural shape passes sortDirection:{direction:"DESC"} with no
    // flat `direction`. Before the fix, that nested direction was dropped, the sort defaulted
    // to ASC, and the tool FALSELY confirmed success on the wrong direction. It must now apply
    // DESC and confirm DESC.
    const { applied } = setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      sortByField: 'display_order',
      sortDirection: { direction: 'DESC' },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(applied()!).toContain(
      "<computed-sort column='[Superstore].[none:line_item:nk]' direction='DESC' using='[Superstore].[sum:display_order:qk]' />",
    );
    expect(applied()!).not.toContain("direction='ASC'");
  });

  it('the flat direction wins when both flat direction and nested sortDirection are passed', async () => {
    const { applied } = setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      sortByField: 'display_order',
      direction: 'asc',
      sortDirection: { direction: 'DESC' },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    successSchema.parse(JSON.parse(result.content[0].text));
    expect(applied()!).toContain("direction='ASC'");
  });
});

describe('refineWorksheetTool — sort_by_field wrong-direction (no false success)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('reports refined:false with a precise reason when the sort lands but the direction is wrong', async () => {
    // e5 defect 2: the sort node lands (right column + using) but with ASC, not the requested
    // DESC — Desktop did not honor the direction. This must NOT confirm success; it must
    // refuse with a reason that names both the applied and the requested direction.
    vi.useFakeTimers();
    // Every readback returns the sheet with the sort node present but direction ASC.
    const wrongDirectionReadback = SORT_BY_FIELD_SOURCE.replace(
      '</datasource-dependencies>',
      "</datasource-dependencies>\n      <computed-sort column='[Superstore].[none:line_item:nk]' direction='ASC' using='[Superstore].[sum:display_order:qk]' />",
    );
    setupMocks({ source: SORT_BY_FIELD_SOURCE, readbackXml: wrongDirectionReadback });
    const resultPromise = getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      sortByField: 'display_order',
      sortDirection: { direction: 'DESC' },
    });
    await vi.advanceTimersByTimeAsync(8 * 250);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(false);
    expect(parsed.reason).toMatch(/direction is ASC/);
    expect(parsed.reason).toMatch(/requested DESC/);
    // Applied exactly once — a wrong-direction readback never triggers a re-apply.
    expect(loadMock()).toHaveBeenCalledTimes(1);
  });
});

describe('refineWorksheetTool — readback race (async apply settle)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('confirms refined:true once a later poll catches the async apply landing', async () => {
    // The live bug: the apply DID land, but the first 2 readback polls race the async
    // settle and still see the pre-apply source. Poll 3 catches the landed XML.
    vi.useFakeTimers();
    const { applied } = setupMocks({ readback: 3 });
    const resultPromise = getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    await vi.advanceTimersByTimeAsync(8 * 250);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);

    // Applied exactly once — the fix polls the READBACK, it never re-applies.
    expect(loadMock()).toHaveBeenCalledTimes(1);
    // 1 fetch + 3 readback polls (2 misses that raced the settle, then the hit).
    expect(getMock()).toHaveBeenCalledTimes(4);
    expect(applied()!).toMatch(/function='end'\s+end='top'\s+count='5'/);
  });

  it('confirms refined:true on the very last poll (attempt 8 of 8)', async () => {
    vi.useFakeTimers();
    setupMocks({ readback: 8 });
    const resultPromise = getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    await vi.advanceTimersByTimeAsync(8 * 250);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(true);
    expect(getMock()).toHaveBeenCalledTimes(9); // 1 fetch + 8 readback polls
  });

  it('a filter that genuinely never lands still reports refined:false after exhausting the polls', async () => {
    // Distinguishes "raced the settle" (above, eventually true) from "never applied"
    // (always false) — both must reach the SAME poll budget before the tool decides.
    vi.useFakeTimers();
    setupMocks({ readback: 'source' });
    const resultPromise = getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    await vi.advanceTimersByTimeAsync(8 * 250);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.refined).toBe(false);
    expect(parsed.reason).toMatch(/async-settle miss/);
    expect(getMock()).toHaveBeenCalledTimes(9);
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

  it('surfaces sheet-absent as an error when the per-sheet route cannot resolve the worksheet', async () => {
    // The behavior this commit introduces: because refine now applies through the per-sheet
    // replace-by-id route (requireExistingSheet:true), a worksheet that vanished between the
    // initial fetch and the apply surfaces as a sheet-absent error — it is NOT silently
    // re-created via the old whole-workbook upsert path.
    const applyErr = {
      type: 'load-worksheet-xml-error' as const,
      error: {
        type: 'sheet-absent' as const,
        message: 'No worksheet named "Sales by Region" is open to update.',
      },
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
    expect(loadMock()).toHaveBeenCalledWith(
      expect.objectContaining({ requireExistingSheet: true }),
    );
  });

  it('does not post when the worksheet changes between the refine fetch and locked apply', async () => {
    const liveSource = SOURCE.replace("<mark class='Bar' />", "<mark class='Line' />");
    const worksheetId = '00000000-0000-0000-0000-000000000001';
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml: liveSource }));
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Err({
        type: 'command-failed',
        error: { code: 'FAILED', message: 'stale input was posted', recoverable: false },
      }),
    );
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: worksheetId, name: 'Sales by Region', hidden: false }],
        }),
      ),
      getWorksheetDocument,
      applyWorksheetDocument,
    });
    const actualLoadModule = await vi.importActual<typeof loadWorksheetXmlModule>(
      '../../../../desktop/wrappers/loadWorksheetXml.js',
    );

    setupMocks({ source: SOURCE });
    loadMock().mockImplementation(actualLoadModule.loadWorksheetXml);

    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
      executor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('changed since this cache was read');
    expect(getWorksheetDocument).toHaveBeenCalledTimes(1);
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
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

  it('refuses when readback never confirms the expected node, after exhausting all polls (applied once)', async () => {
    // Apply succeeds, but every readback poll returns the un-patched source (the filter
    // genuinely never lands) → confirmation fails on every poll → refuse after the poll
    // budget, no retry beyond it.
    vi.useFakeTimers();
    setupMocks({ readback: 'source' });
    const resultPromise = getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
      topN: { n: 5 },
    });
    await vi.advanceTimersByTimeAsync(8 * 250);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/readback did not contain/);
    expect(parsed.reason).toMatch(/after 8 polls/);
    expect(loadMock()).toHaveBeenCalledTimes(1);
    // 1 fetch + 8 readback polls, all exhausted — never retries the apply.
    expect(getMock()).toHaveBeenCalledTimes(9);
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

  it('errors when operation=sort_by_field is missing sortByField, before touching Tableau', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'sort_by_field',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('sortByField is required when operation=sort_by_field.').message,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('errors when operation=top_n is missing topN, before touching Tableau', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'top_n',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('topN is required when operation=top_n.').message,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('errors when operation=sort_direction is missing sortDirection, before touching Tableau', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'sort_direction',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('sortDirection is required when operation=sort_direction.').message,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('errors when operation=mark_type is missing markType, before touching Tableau', async () => {
    setupMocks();
    const result = await getToolResult({
      worksheetName: 'Sales by Region',
      operation: 'mark_type',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('markType is required when operation=mark_type.').message,
    );
    expect(getMock()).not.toHaveBeenCalled();
    expect(loadMock()).not.toHaveBeenCalled();
  });

  it('refuses an unknown sort_by_field caption and never applies', async () => {
    setupMocks({ source: SORT_BY_FIELD_SOURCE });
    const result = await getToolResult({
      worksheetName: 'Waterfall',
      operation: 'sort_by_field',
      targetField: 'Missing Field',
      sortByField: 'display_order',
      direction: 'desc',
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toMatch(/target field/i);
    expect(parsed.reason).toMatch(/Missing Field/);
    expect(loadMock()).not.toHaveBeenCalled();
  });
});

const successSchema = z.object({
  refined: z.literal(true),
  operation: z.enum(['top_n', 'sort_direction', 'sort_by_field', 'mark_type', 'round_stacked_bar']),
  worksheetName: z.string(),
  message: z.string(),
  verification: z
    .object({
      helperFields: z.number().int().nonnegative(),
      summaryGroups: z.number().int().nonnegative(),
      summaryRows: z.number().int().nonnegative(),
    })
    .optional(),
});

const refusalSchema = z.object({
  refined: z.literal(false),
  operation: z.enum(['top_n', 'sort_direction', 'sort_by_field', 'mark_type', 'round_stacked_bar']),
  worksheetName: z.string(),
  reason: z.string(),
});

async function getToolResult({
  worksheetName,
  operation,
  topN,
  sortDirection,
  targetField,
  sortByField,
  direction,
  markType,
  preset,
  session = '12345',
  executor = makeExecutorMock(),
}: {
  worksheetName: string;
  operation: 'top_n' | 'sort_direction' | 'sort_by_field' | 'mark_type' | 'round_stacked_bar';
  topN?: { n: number; end?: 'top' | 'bottom' };
  sortDirection?: { direction: 'ASC' | 'DESC' };
  targetField?: string;
  sortByField?: string;
  direction?: 'asc' | 'desc';
  markType?:
    | 'automatic'
    | 'bar'
    | 'line'
    | 'area'
    | 'square'
    | 'circle'
    | 'shape'
    | 'text'
    | 'pie'
    | 'gantt_bar'
    | 'polygon';
  preset?: 'subtle';
  session?: string;
  executor?: ExternalApiToolExecutor;
}): Promise<CallToolResult> {
  const tool = getRefineWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return await callback(
    {
      session,
      worksheetName,
      operation,
      topN,
      sortDirection,
      targetField,
      sortByField,
      direction,
      markType,
      preset,
    },
    extra,
  );
}
