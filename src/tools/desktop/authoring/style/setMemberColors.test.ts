import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';
import type { Mock } from 'vitest';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { TableauDesktopToolContext } from '../../toolContext.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import {
  AGG_CI,
  AGG_COLUMN,
  AGG_COLUMN_IN_DATASOURCE,
  BOOL_CI,
  BOOL_COLUMN,
  BOOL_COLUMN_IN_DATASOURCE,
  CATEGORY_COLUMN,
  datasourceDoc,
  DEFAULT_PALETTE_STYLE,
  encodingXml,
  SET_CI,
  STRING_CI,
  styleXml,
  worksheetXml,
} from './memberColorsTestFixtures.js';
import { getSetMemberColorsTool } from './setMemberColors.js';

vi.mock('../../../../desktop/session/sessionResolution.js');

const FIELD = '[none:Category:nk]';

type Args = {
  worksheetName?: string;
  colors: Array<{ member: string; color: string }>;
  field?: string;
};

type Setup = {
  sheetXml?: string;
  datasource?: string;
  /** Datasource documents returned by reads after the apply; default echoes the applied document. */
  afterApply?: (applied: string) => string;
  applyError?: ExecuteCommandError;
  /** Fails every datasource read after the apply. */
  readError?: ExecuteCommandError;
  signal?: AbortSignal;
  datasources?: Array<{ id: string; name: string }>;
  /** Summary data the sheet returns; default lists the Category members. `error` fails the read. */
  summary?:
    | { columns: Array<string | { name: string; dataType?: string }>; rows: string[][] }
    | 'error';
  /** Datasource document returned by the re-read inside the apply lock. */
  reread?: string;
  warnings?: Array<{ code: string; message: string }>;
  /** The first summary read returns no columns, as for a sheet that was never rendered. */
  neverRendered?: boolean;
};

const CATEGORY_SUMMARY = {
  columns: ['Category'],
  rows: [['Furniture'], ['Office Supplies'], ['Technology']],
};

async function run(
  args: Args,
  setup: Setup = {},
): Promise<{
  result: CallToolResult;
  executor: ReturnType<typeof makeExecutorMock>;
  applyDatasourceDocument: Mock<(id: string, xml: string) => Promise<unknown>>;
  getDatasourceDocument: Mock<() => Promise<unknown>>;
}> {
  const baseline = setup.datasource ?? datasourceDoc({ instances: STRING_CI });
  let applied: string | undefined;
  let reads = 0;
  let rendered = false;
  const getDatasourceDocument = vi.fn(async () =>
    (reads += 1) === 2 && setup.reread !== undefined
      ? Ok({ xml: setup.reread, applicationVersion: undefined, xsdPayloadVersion: undefined })
      : applied !== undefined && setup.readError
        ? Err(setup.readError)
        : Ok({
            xml: applied === undefined ? baseline : (setup.afterApply?.(applied) ?? applied),
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
  );
  const applyDatasourceDocument = vi.fn(async (_id: string, xml: string) => {
    applied = xml;
    return setup.applyError
      ? Err(setup.applyError)
      : Ok({
          command_id: 'c',
          status: 'completed' as const,
          submitted_at: '2026-10-18T00:00:00Z',
          warnings: setup.warnings ?? [],
        });
  });
  const executor = makeExecutorMock({
    listWorksheets: vi.fn().mockResolvedValue(Ok({ worksheets: [{ id: 'ws-1', name: 'L1' }] })),
    getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: setup.sheetXml ?? worksheetXml() })),
    listWorkbookDatasources: vi
      .fn()
      .mockResolvedValue(
        Ok({ datasources: setup.datasources ?? [{ id: 'superstore', name: 'superstore' }] }),
      ),
    getDatasourceDocument,
    applyDatasourceDocument,
    exportWorksheetImage: vi.fn().mockImplementation(async () => {
      rendered = true;
      return Ok({});
    }),
    getWorksheetSummaryData: vi
      .fn()
      .mockImplementation(async (_id, _query, signal?: AbortSignal) => {
        if (setup.neverRendered && !rendered) return Ok({ columns: [], rows: [] });
        if (setup.summary === 'error' || signal?.aborted) {
          return Err({
            type: 'command-failed' as const,
            error: { code: 'internal', message: 'no data', recoverable: true },
          });
        }
        const summary = setup.summary ?? CATEGORY_SUMMARY;
        return Ok({
          columns: summary.columns.map((column) =>
            typeof column === 'string' ? { name: column, dataType: 'cstring' } : column,
          ),
          rows: summary.rows,
        });
      }),
  });
  const tool = getSetMemberColorsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi
      .fn()
      .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    ...(setup.signal === undefined ? {} : { signal: setup.signal }),
  };
  const pending = callback(
    { session: 'requested', worksheetName: 'L1', field: undefined, ...args },
    extra,
  );
  await vi.runAllTimersAsync();
  const result = await pending;
  return { result, executor, applyDatasourceDocument, getDatasourceDocument };
}

function text(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function body(result: CallToolResult): Record<string, any> {
  return JSON.parse(text(result));
}

const FURNITURE_RED = { colors: [{ member: 'Furniture', color: '#FF0000' }] };

describe('set-member-colors tool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('123'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has a lean description, no tool names in params, and the datasource-route API floor', () => {
    const tool = getSetMemberColorsTool(new DesktopMcpServer());
    expect(tool.name).toBe('set-member-colors');
    expect(tool.description).toBe(
      "Set colors for members of the discrete field on a worksheet's Color.",
    );
    expect(tool.minApiVersion).toBe('0.2.10');
    expect(Object.keys(tool.paramsSchema)).toEqual(['session', 'worksheetName', 'colors', 'field']);
  });

  it('sets a plain dimension through the datasource route and reports the verified readback', async () => {
    const { result, applyDatasourceDocument, executor } = await run({
      colors: [
        { member: 'Furniture', color: '#FF0000' },
        { member: 'Technology', color: '#0000ff' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(body(result)).toEqual({
      message:
        'Set 2 member color(s) for Category in datasource superstore: Furniture -> #ff0000; Technology -> #0000ff. ' +
        'Read back the datasource document: every requested member color matched.',
      field: 'Category',
      datasource: 'superstore',
      colors: [
        { member: 'Furniture', color: '#ff0000' },
        { member: 'Technology', color: '#0000ff' },
      ],
    });
    expect(applyDatasourceDocument).toHaveBeenCalledOnce();
    expect(applyDatasourceDocument.mock.calls[0][0]).toBe('superstore');
    expect(applyDatasourceDocument.mock.calls[0][1]).toContain(
      "<encoding attr='color' field='[none:Category:nk]' type='palette'>",
    );
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('adds the sheet column-instance when the datasource has none (the L1a drop case)', async () => {
    const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
      datasource: datasourceDoc(),
    });
    expect(result.isError).toBe(false);
    expect(applyDatasourceDocument.mock.calls[0][1]).toContain(STRING_CI);
  });

  it('colors a boolean calculation whose instance is none:, with true/false buckets', async () => {
    const { result, applyDatasourceDocument } = await run(
      {
        colors: [
          { member: 'True', color: '#ff0000' },
          { member: 'false', color: '#d4c37a' },
        ],
      },
      {
        sheetXml: worksheetXml({
          panes: ['[superstore].[none:Calculation_B001:nk]'],
          columns: [BOOL_COLUMN, CATEGORY_COLUMN],
          instances: [BOOL_CI, STRING_CI],
        }),
        datasource: datasourceDoc({ columns: BOOL_COLUMN_IN_DATASOURCE, instances: BOOL_CI }),
      },
    );
    expect(result.isError).toBe(false);
    expect(body(result).colors).toEqual([
      { member: 'true', color: '#ff0000' },
      { member: 'false', color: '#d4c37a' },
    ]);
    expect(applyDatasourceDocument.mock.calls[0][1]).toContain(
      "<encoding attr='color' field='[none:Calculation_B001:nk]' type='palette'><map to='#ff0000'><bucket>true</bucket></map><map to='#d4c37a'><bucket>false</bucket></map></encoding>",
    );
  });

  it('colors a usr: aggregate calculation', async () => {
    const { result, applyDatasourceDocument } = await run(
      { colors: [{ member: 'Favorable', color: '#59a14f' }] },
      {
        sheetXml: worksheetXml({
          panes: ['[superstore].[usr:Calculation_7001:nk]'],
          columns: [AGG_COLUMN],
          instances: [AGG_CI],
        }),
        datasource: datasourceDoc({ columns: AGG_COLUMN_IN_DATASOURCE }),
      },
    );
    expect(result.isError).toBe(false);
    expect(applyDatasourceDocument.mock.calls[0][1]).toContain(AGG_CI);
    expect(applyDatasourceDocument.mock.calls[0][1]).toContain(
      "field='[usr:Calculation_7001:nk]' type='palette'",
    );
  });

  it('passes when Desktop writes the encoding twice and merges with an existing style', async () => {
    const existing = encodingXml(FIELD, [['#59a14f', '&quot;Office Supplies&quot;']]);
    const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
      datasource: datasourceDoc({ instances: STRING_CI, style: styleXml(existing, existing) }),
    });
    expect(result.isError).toBe(false);
    const sent = applyDatasourceDocument.mock.calls[0][1];
    expect(sent.match(/<bucket>&quot;Office Supplies&quot;<\/bucket>/g)).toHaveLength(2);
    expect(sent.match(/<bucket>&quot;Furniture&quot;<\/bucket>/g)).toHaveLength(2);
  });

  it('fails, never succeeds, when the readback never settles on the colors', async () => {
    const { result, getDatasourceDocument } = await run(FURNITURE_RED, {
      afterApply: () => datasourceDoc({ instances: STRING_CI }),
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'Desktop accepted the change but the datasource readback does not match.',
    );
    expect(text(result)).toContain('[none:Category:nk]: Furniture expected #ff0000, found missing');
    expect(text(result)).toContain('Do not tell the user these colors are set.');
    expect(text(result)).toContain('If it fails again, tell the user the colors could not be set.');
    expect(text(result)).not.toContain('Set 1 member color');
    expect(getDatasourceDocument.mock.calls.length).toBeGreaterThan(2);
  });

  it('fails when Desktop keeps a different color for the member', async () => {
    const { result } = await run(FURNITURE_RED, {
      afterApply: (applied) => applied.replaceAll('#ff0000', '#4e79a7'),
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Furniture expected #ff0000, found #4e79a7');
  });

  it('does not claim success when the apply is rejected', async () => {
    const { result, getDatasourceDocument } = await run(FURNITURE_RED, {
      applyError: {
        type: 'command-failed',
        error: { code: 'invalid-xml', message: 'bad document', recoverable: false },
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('bad document');
    expect(getDatasourceDocument).toHaveBeenCalledTimes(2);
  });

  it('returns an error, not a success headline, when the readback is interrupted', async () => {
    const controller = new AbortController();
    const { result } = await run(FURNITURE_RED, {
      signal: controller.signal,
      afterApply: () => {
        controller.abort(new Error('client went away'));
        return datasourceDoc({ instances: STRING_CI });
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'Sent the colors for Furniture but could not read the datasource back, so they are not confirmed',
    );
    expect(text(result)).toContain(
      'Do not tell the user these colors are set. The call is safe to repeat. If it fails again, tell the user the colors could not be set.',
    );
    expect(text(result)).not.toContain('Set 1 member color');
  });

  it('returns an error when the datasource cannot be read back', async () => {
    const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
      readError: {
        type: 'command-failed',
        error: { code: 'internal', message: 'desktop busy', recoverable: true },
      },
    });
    expect(applyDatasourceDocument).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('could not read the datasource back, so they are not confirmed');
    expect(text(result)).toContain('Do not tell the user these colors are set.');
    expect(text(result)).not.toContain('Set 1 member color');
  });

  it('writes the existing spelling for "furniture" and drops the generic line', async () => {
    const { result, applyDatasourceDocument } = await run(
      { colors: [{ member: 'furniture', color: '#FF0000' }] },
      { datasource: datasourceDoc({ instances: STRING_CI, style: DEFAULT_PALETTE_STYLE }) },
    );
    expect(result.isError).toBe(false);
    const sent = applyDatasourceDocument.mock.calls[0][1];
    expect(sent.match(/Furniture/gi)).toHaveLength(1);
    expect(sent).toContain("<map to='#ff0000'><bucket>&quot;Furniture&quot;</bucket></map>");
    expect(body(result).colors).toEqual([{ member: 'Furniture', color: '#ff0000' }]);
    expect(body(result).message).not.toContain('not in the data');
    expect(body(result).message).not.toContain('not in the field');
  });

  describe('member spelling against the sheet data', () => {
    const regionSheet = worksheetXml({
      columns: [{ datatype: 'string', name: '[Region]', role: 'dimension' }],
      instances: [
        "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
      ],
      panes: ['[superstore].[none:Region:nk]'],
    });
    const regionSummary = { columns: ['Region'], rows: [['Asia'], ['Europe'], ['Europe']] };
    const regionDoc = (aliases = ''): string =>
      datasourceDoc({
        columns: `<column datatype='string' name='[Region]' role='dimension' type='nominal'>${aliases}</column>`,
        instances:
          "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
      });
    const region = { sheetXml: regionSheet, summary: regionSummary };

    it('writes the data spelling, not the typed one, on a case-sensitive source (europe -> Europe)', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'europe', color: '#E15759' }] },
        { ...region, datasource: regionDoc() },
      );
      expect(result.isError).toBe(false);
      const sent = applyDatasourceDocument.mock.calls[0][1];
      expect(sent).toContain('<bucket>&quot;Europe&quot;</bucket>');
      expect(sent).not.toContain('&quot;europe&quot;');
      expect(body(result).colors).toEqual([{ member: 'Europe', color: '#e15759' }]);
      expect(body(result).message).toContain('Matched members: europe -> Europe.');
    });

    it('resolves an alias display value to the raw member and says so', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'EU', color: '#e15759' }] },
        {
          ...region,
          datasource: regionDoc("<aliases><alias key='&quot;Europe&quot;' value='EU' /></aliases>"),
        },
      );
      expect(result.isError).toBe(false);
      expect(applyDatasourceDocument.mock.calls[0][1]).toContain(
        '<bucket>&quot;Europe&quot;</bucket>',
      );
      expect(body(result).message).toContain('Matched members: EU -> Europe (alias).');
    });

    it('matches an AGG() column for an aggregate calculation', async () => {
      const { result } = await run(
        { colors: [{ member: 'favorable', color: '#59a14f' }] },
        {
          sheetXml: worksheetXml({
            panes: ['[superstore].[usr:Calculation_7001:nk]'],
            columns: [AGG_COLUMN],
            instances: [AGG_CI],
          }),
          datasource: datasourceDoc({ columns: AGG_COLUMN_IN_DATASOURCE }),
          summary: { columns: ['AGG(Plan Status)'], rows: [['Favorable'], ['Off plan']] },
        },
      );
      expect(result.isError).toBe(false);
      expect(body(result).colors).toEqual([{ member: 'Favorable', color: '#59a14f' }]);
    });

    it('refuses before any write when a member is not in the fully read data', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'Mars', color: '#e15759' }] },
        { ...region, datasource: regionDoc() },
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Mars is not in this sheet's data, so nothing was changed.");
      expect(text(result)).toContain('Members in the data: Asia, Europe.');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it.each([
      ['the summary data cannot be read', { summary: 'error' as const }],
      ['no summary column matches the field', { summary: { columns: ['Other'], rows: [['x']] } }],
    ])('says members were not checked when %s, and writes as before', async (_label, setup) => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'Mars', color: '#e15759' }] },
        { sheetXml: regionSheet, datasource: regionDoc(), ...setup },
      );
      expect(result.isError).toBe(false);
      expect(applyDatasourceDocument).toHaveBeenCalledOnce();
      expect(body(result).message).toContain(
        'Members could not be checked against the data, so a member that is not in the data has no effect.',
      );
    });

    it('keeps a not-found note, without refusing, when the read hit the row cap', async () => {
      const rows = Array.from({ length: 10000 }, (_, index) => [`R${index}`]);
      const { result } = await run(
        { colors: [{ member: 'Mars', color: '#e15759' }] },
        { sheetXml: regionSheet, datasource: regionDoc(), summary: { columns: ['Region'], rows } },
      );
      expect(result.isError).toBe(false);
      expect(body(result).message).toContain('Mars was not found in the first 10000 rows read');
    });

    it('reads underlying values, not display aliases', async () => {
      const { executor } = await run(
        { colors: [{ member: 'Europe', color: '#e15759' }] },
        { ...region, datasource: regionDoc() },
      );
      expect(executor.getWorksheetSummaryData).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ ignoreAliases: true, maxRows: 10000 }),
        expect.anything(),
      );
    });

    it('reads the data before the datasource document it edits', async () => {
      const { executor, getDatasourceDocument } = await run(
        { colors: [{ member: 'Europe', color: '#e15759' }] },
        { ...region, datasource: regionDoc() },
      );
      const summaryOrder = vi.mocked(executor.getWorksheetSummaryData).mock.invocationCallOrder[0];
      expect(summaryOrder).toBeLessThan(getDatasourceDocument.mock.invocationCallOrder[0]);
    });

    it.each([
      [
        'two columns match the field',
        { columns: ['Region', 'ATTR(Region)'], rows: [['Asia', 'x']] },
      ],
      [
        'the column is not a string',
        { columns: [{ name: 'Region', dataType: 'real' }], rows: [['1']] },
      ],
    ])('treats the members as unchecked when %s', async (_label, summary) => {
      const { result } = await run(
        { colors: [{ member: 'Mars', color: '#e15759' }] },
        { sheetXml: regionSheet, datasource: regionDoc(), summary },
      );
      expect(result.isError).toBe(false);
      expect(body(result).message).toContain('Members could not be checked against the data');
    });

    it('treats the members as unchecked when the data read times out', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
      try {
        const { result } = await run(
          { colors: [{ member: 'Mars', color: '#e15759' }] },
          { ...region, datasource: regionDoc() },
        );
        expect(timeout).toHaveBeenCalledWith(5000);
        expect(result.isError).toBe(false);
        expect(body(result).message).toContain('Members could not be checked against the data');
      } finally {
        timeout.mockRestore();
      }
    });

    it('refuses the Null member before any write', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'Null', color: '#e15759' }] },
        { ...region, datasource: regionDoc() },
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('cannot color the Null member');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it('replays the live cstring response: europe -> Europe, Atlantis refused before any write', async () => {
      const live = {
        columns: [{ name: 'Region', dataType: 'cstring' }],
        rows: [['Europe'], ['Asia'], ['Africa'], ['Oceania']],
      };
      const ok = await run(
        { colors: [{ member: 'europe', color: '#e15759' }] },
        { ...region, datasource: regionDoc(), summary: live },
      );
      expect(ok.result.isError).toBe(false);
      expect(ok.applyDatasourceDocument.mock.calls[0][1]).toContain(
        '<bucket>&quot;Europe&quot;</bucket>',
      );
      expect(body(ok.result).message).toContain('europe -> Europe');

      const refused = await run(
        { colors: [{ member: 'Atlantis', color: '#e15759' }] },
        { ...region, datasource: regionDoc(), summary: live },
      );
      expect(refused.result.isError).toBe(true);
      expect(text(refused.result)).toContain('Members in the data: Europe, Asia, Africa, Oceania.');
      expect(refused.applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it('exports an image for a never-rendered sheet, then resolves from the data', async () => {
      const { result, executor } = await run(
        { colors: [{ member: 'europe', color: '#e15759' }] },
        { ...region, datasource: regionDoc(), neverRendered: true },
      );
      expect(executor.exportWorksheetImage).toHaveBeenCalledOnce();
      expect(result.isError).toBe(false);
      expect(body(result).colors).toEqual([{ member: 'Europe', color: '#e15759' }]);
    });

    it('notes a member that matched only the existing color map when the data was read in full', async () => {
      const { result } = await run(
        { colors: [{ member: 'Eurpoe', color: '#e15759' }] },
        {
          ...region,
          datasource: datasourceDoc({
            instances:
              "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
            style: styleXml(encodingXml('[none:Region:nk]', [['#4e79a7', '&quot;Eurpoe&quot;']])),
          }),
        },
      );
      expect(result.isError).toBe(false);
      expect(body(result).message).toContain(
        "Eurpoe is not in this sheet's data; it matched the field's existing color map.",
      );
    });

    it('notes an alias whose raw value is not in the fully read data, and still writes it', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'EU', color: '#e15759' }] },
        {
          sheetXml: regionSheet,
          summary: { columns: ['Region'], rows: [['Asia']] },
          datasource: regionDoc("<aliases><alias key='&quot;Europe&quot;' value='EU' /></aliases>"),
        },
      );
      expect(result.isError).toBe(false);
      expect(applyDatasourceDocument.mock.calls[0][1]).toContain(
        '<bucket>&quot;Europe&quot;</bucket>',
      );
      expect(body(result).message).toContain(
        "EU is an alias for Europe, which is not in this sheet's data.",
      );
    });

    it('does not read the data for a boolean field', async () => {
      const { executor } = await run(
        { colors: [{ member: 'true', color: '#ff0000' }] },
        {
          sheetXml: worksheetXml({
            panes: ['[superstore].[none:Calculation_B001:nk]'],
            columns: [BOOL_COLUMN],
            instances: [BOOL_CI],
          }),
        },
      );
      expect(executor.getWorksheetSummaryData).not.toHaveBeenCalled();
    });
  });

  it('writes the trimmed member and refuses a blank one', async () => {
    const trimmed = await run({ colors: [{ member: '  Furniture  ', color: '#ff0000' }] });
    expect(trimmed.result.isError).toBe(false);
    expect(trimmed.applyDatasourceDocument.mock.calls[0][1]).toContain(
      '<bucket>&quot;Furniture&quot;</bucket>',
    );
    const blank = await run({ colors: [{ member: '   ', color: '#ff0000' }] });
    expect(blank.result.isError).toBe(true);
    expect(text(blank.result)).toContain('non-empty');
    expect(blank.applyDatasourceDocument).not.toHaveBeenCalled();
  });

  it('applies nothing when the datasource changed between the read and the apply', async () => {
    const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
      reread: datasourceDoc({ instances: STRING_CI }).replace(
        '</datasource>',
        '<!-- x --></datasource>',
      ),
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('The datasource changed during the call');
    expect(text(result)).toContain('safe to repeat');
    expect(applyDatasourceDocument).not.toHaveBeenCalled();
  });

  it("surfaces Desktop's apply warnings in the success message and result", async () => {
    const warnings = [{ code: 'dropped', message: 'something was dropped' }];
    const { result } = await run(FURNITURE_RED, { warnings });
    expect(result.isError).toBe(false);
    expect(body(result).message).toContain('DESKTOP WARNINGS');
    expect(body(result).message).toContain('- dropped: something was dropped');
    expect(body(result).warnings).toEqual(warnings);
  });

  it('reads back inside the apply lock, so a second call re-reads the first call write', async () => {
    let doc = datasourceDoc({ instances: STRING_CI });
    let staleReads = 0;
    const before = doc;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(Ok({ worksheets: [{ id: 'ws-1', name: 'L1' }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: worksheetXml() })),
      listWorkbookDatasources: vi
        .fn()
        .mockResolvedValue(Ok({ datasources: [{ id: 'superstore', name: 'superstore' }] })),
      getWorksheetSummaryData: vi.fn().mockResolvedValue(
        Ok({
          columns: [{ name: 'Category' }],
          rows: [['Furniture'], ['Technology']],
        }),
      ),
      // Desktop can show pre-apply state for a moment after an apply settles.
      getDatasourceDocument: vi.fn(async () =>
        Ok({
          xml: staleReads > 0 && staleReads-- ? before : doc,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyDatasourceDocument: vi.fn(async (_id: string, xml: string) => {
        doc = xml;
        staleReads = 2;
        return Ok({
          command_id: 'c',
          status: 'completed' as const,
          submitted_at: '2026-10-18T00:00:00Z',
          warnings: [],
        });
      }),
    });
    const callback = await Provider.from(getSetMemberColorsTool(new DesktopMcpServer()).callback);
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    };
    const call = async (member: string, color: string): Promise<CallToolResult> =>
      await callback(
        {
          session: 'requested',
          worksheetName: 'L1',
          field: undefined,
          colors: [{ member, color }],
        },
        extra,
      );
    const first = call('Furniture', '#ff0000');
    const second = call('Technology', '#0000ff');
    await vi.runAllTimersAsync();
    const results = await Promise.all([first, second]);

    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(text(results[1])).toContain('The datasource changed during the call');
    expect(executor.applyDatasourceDocument).toHaveBeenCalledOnce();
  });

  it('is marked destructive, like apply-datasource', async () => {
    const annotations = await Provider.from(
      getSetMemberColorsTool(new DesktopMcpServer()).annotations,
    );
    expect(annotations?.destructiveHint).toBe(true);
  });

  it('names a sheet-level color that differs from the datasource, and only that one', async () => {
    const sheetStyle = styleXml(
      encodingXml(FIELD, [
        ['#ff0000', '&quot;Furniture&quot;'],
        ['#00ff00', '&quot;Technology&quot;'],
      ]),
    );
    const { result } = await run(FURNITURE_RED, {
      sheetXml: worksheetXml({ tableStyle: sheetStyle }),
    });
    expect(result.isError).toBe(false);
    const message = body(result).message;
    expect(message).toContain(
      "Note: the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Technology #00ff00 (not in the datasource). Edit Colors may show those instead.",
    );
    expect(message).not.toContain('Furniture #ff0000 (');
    expect(message).not.toContain('put it in the datasource');
  });

  it('adds no stale note when the request sets the color the sheet map already holds', async () => {
    const sheetStyle = styleXml(encodingXml(FIELD, [['#ff0000', '&quot;Furniture&quot;']]));
    const { result } = await run(FURNITURE_RED, {
      sheetXml: worksheetXml({ tableStyle: sheetStyle }),
    });
    expect(result.isError).toBe(false);
    expect(body(result).message).not.toContain('Note:');
  });

  describe('with the live-shaped sheet and datasource fixtures', () => {
    const fixture = (name: string): string =>
      readFileSync(
        join(__dirname, '../../../../desktop/validation/__fixtures__/color-map', name),
        'utf8',
      );
    const live = {
      sheetXml: fixture('ok-L1-ws.xml'),
      datasource: fixture('rb-ok-L1-dirty-ds.xml'),
    };

    it('names the sheet color Desktop ignores when the sheet field is qualified with the datasource', async () => {
      const { result } = await run({ colors: [{ member: 'Furniture', color: '#123456' }] }, live);
      expect(result.isError).toBe(false);
      expect(body(result).message).toContain('Furniture #ff0000 (the chart uses #123456)');
    });

    it('adds no note when the request matches the qualified sheet map', async () => {
      const { result } = await run(FURNITURE_RED, live);
      expect(result.isError).toBe(false);
      expect(body(result).message).not.toContain('Note:');
    });
  });

  it('shows the color the chart uses when the sheet map disagrees with the request', async () => {
    const sheetStyle = styleXml(encodingXml(FIELD, [['#00ff00', '&quot;Furniture&quot;']]));
    const { result } = await run(FURNITURE_RED, {
      sheetXml: worksheetXml({ tableStyle: sheetStyle }),
    });
    expect(body(result).message).toContain('Furniture #00ff00 (the chart uses #ff0000)');
  });

  describe('multi-pane sheets', () => {
    const twoFields = worksheetXml({
      panes: ['[superstore].[none:Category:nk]', '[superstore].[none:Calculation_B001:nk]'],
      columns: [BOOL_COLUMN, CATEGORY_COLUMN],
      instances: [BOOL_CI, STRING_CI],
    });

    it('colors one field that every pane shares', async () => {
      const { result } = await run(FURNITURE_RED, {
        sheetXml: worksheetXml({
          panes: ['[superstore].[none:Category:nk]', '[superstore].[none:Category:nk]'],
        }),
      });
      expect(result.isError).toBe(false);
    });

    it('needs field when panes color different fields, and makes no Desktop write', async () => {
      const { result, applyDatasourceDocument } = await run(FURNITURE_RED, { sheetXml: twoFields });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Pass field to choose one.');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it('colors the chosen field when field is given', async () => {
      const { result } = await run(
        { ...FURNITURE_RED, field: 'Category' },
        { sheetXml: twoFields },
      );
      expect(result.isError).toBe(false);
      expect(body(result).field).toBe('Category');
    });

    it('refuses Measure Names', async () => {
      const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
        sheetXml: worksheetXml({ panes: ['[superstore].[:Measure Names]'] }),
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Measure Names and Measure Values colors are not supported.');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });
  });

  describe('refusals make no write', () => {
    it.each([
      [
        'no field on Color',
        { sheetXml: worksheetXml({ panes: [null] }) },
        'Put a discrete field on Color first.',
      ],
      [
        'a continuous field',
        { sheetXml: worksheetXml({ panes: ['[superstore].[sum:Sales:qk]'] }) },
        'is continuous',
      ],
      [
        'a set',
        {
          sheetXml: worksheetXml({
            panes: ['[superstore].[io:Sub-Category Set:nk]'],
            columns: [],
            instances: [SET_CI],
          }),
        },
        '"Sub-Category Set" is a set; colors can be set only on fields.',
      ],
      [
        'a group',
        {
          sheetXml: worksheetXml({
            columns: [
              {
                datatype: 'string',
                name: '[Category]',
                role: 'dimension',
                calc: "<calculation class='categorical-bin' column='[Product Name]' new-bin='true' />",
              },
            ],
          }),
        },
        'is a group',
      ],
      [
        'a date field',
        {
          sheetXml: worksheetXml({
            columns: [{ datatype: 'date', name: '[Category]', role: 'dimension' }],
          }),
        },
        'has datatype date',
      ],
    ] as const)('%s', async (_label, setup, expected) => {
      const { result, applyDatasourceDocument } = await run(FURNITURE_RED, setup as Setup);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(expected);
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it('a boolean member that is not true or false', async () => {
      const { result, applyDatasourceDocument } = await run(
        { colors: [{ member: 'Yes', color: '#ff0000' }] },
        {
          sheetXml: worksheetXml({
            panes: ['[superstore].[none:Calculation_B001:nk]'],
            columns: [BOOL_COLUMN],
            instances: [BOOL_CI],
          }),
        },
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('use true or false');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });

    it('a datasource missing from the workbook', async () => {
      const { result, applyDatasourceDocument } = await run(FURNITURE_RED, { datasources: [] });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Datasource "superstore" is not in the workbook.');
      expect(applyDatasourceDocument).not.toHaveBeenCalled();
    });
  });

  it('finds a datasource whose inventory id is the URL-encoded internal name', async () => {
    const { result, applyDatasourceDocument } = await run(FURNITURE_RED, {
      sheetXml: worksheetXml({
        datasource: 'federated.0abc def',
        panes: ['[federated.0abc def].[none:Category:nk]'],
      }),
      datasource: datasourceDoc({ instances: STRING_CI }).replace(
        "name='superstore'",
        "name='federated.0abc def'",
      ),
      datasources: [{ id: 'federated.0abc%20def', name: 'Orders' }],
    });
    expect(result.isError).toBe(false);
    expect(applyDatasourceDocument.mock.calls[0][0]).toBe('federated.0abc%20def');
  });
});
