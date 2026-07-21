import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { normalizeArray, parseXML, serializeXML } from '../../../desktop/metadata/parser.js';
import type { ParsedWindow, ParsedWorksheet } from '../../../desktop/metadata/types.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
  WorksheetNotFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteWorksheetTool, removeWorksheetFromWorkbook } from './deleteWorksheet.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');

// ── Fixture builder ───────────────────────────────────────────────────────────
// A minimal but structurally honest workbook: worksheets + per-sheet worksheet
// windows, plus dashboards whose referencing zone is NESTED inside a layout
// container (recursion must find it, exactly like real Desktop output).

function worksheetXml(name: string): string {
  return `<worksheet name='${name}'><table><view/><style/><panes><pane><view/></pane></panes></table></worksheet>`;
}

function worksheetWindowXml(name: string): string {
  return `<window class='worksheet' name='${name}'><cards/></window>`;
}

function dashboardXml(name: string, referencedSheet?: string): string {
  const inner = referencedSheet
    ? `<zone h='98000' id='3' w='98000' x='1000' y='1000' name='${referencedSheet}'/>`
    : '';
  return [
    `<dashboard name='${name}'>`,
    `<zones><zone h='100000' id='2' type-v2='layout-basic' w='100000' x='0' y='0'>${inner}</zone></zones>`,
    '</dashboard>',
  ].join('');
}

function buildWorkbook({
  sheets = ['Alpha', 'Beta'],
  dashboards = [] as string[],
  extraWindows = [] as string[],
  extraBody = '',
}: {
  sheets?: string[];
  dashboards?: string[];
  extraWindows?: string[];
  extraBody?: string;
} = {}): string {
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    "<workbook version='18.1'>",
    "<datasources><datasource name='Superstore'/></datasources>",
    `<worksheets>${sheets.map(worksheetXml).join('')}</worksheets>`,
    dashboards.length > 0 ? `<dashboards>${dashboards.join('')}</dashboards>` : '',
    extraBody,
    `<windows>${sheets.map(worksheetWindowXml).join('')}${extraWindows.join('')}</windows>`,
    '</workbook>',
  ].join('');
}

function worksheetNames(xml: string): string[] {
  const parsed = parseXML(xml);
  return normalizeArray<ParsedWorksheet>(parsed.workbook?.worksheets?.worksheet).map(
    (ws) => ws['@_name'],
  );
}

function windowEntries(xml: string): Array<{ name: string; klass: string }> {
  const parsed = parseXML(xml);
  return normalizeArray<ParsedWindow>(parsed.workbook?.windows?.window).map((w) => ({
    name: String(w['@_name']),
    klass: String(w['@_class']),
  }));
}

// ── Pure removal core ─────────────────────────────────────────────────────────

describe('removeWorksheetFromWorkbook', () => {
  it('removes the worksheet node and its worksheet-class window entry', () => {
    const result = removeWorksheetFromWorkbook(buildWorkbook(), 'Beta');
    invariant(result.status === 'removed');
    expect(worksheetNames(result.xml)).toEqual(['Alpha']);
    expect(windowEntries(result.xml)).toEqual([{ name: 'Alpha', klass: 'worksheet' }]);
  });

  it('removes an entity-escaped worksheet when called with its literal name', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({ sheets: ['Alpha', 'P&amp;L Waterfall: Revenue to Net Income'] }),
      'P&L Waterfall: Revenue to Net Income',
    );

    invariant(result.status === 'removed');
    expect(worksheetNames(result.xml)).toEqual(['Alpha']);
    expect(windowEntries(result.xml)).toEqual([{ name: 'Alpha', klass: 'worksheet' }]);
  });

  it('removes a special-character worksheet when called with an escaped legacy name', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({ sheets: ['Alpha', 'Revenue &lt; &quot;Gross&quot;'] }),
      'Revenue &lt; &quot;Gross&quot;',
    );

    invariant(result.status === 'removed');
    expect(worksheetNames(result.xml)).toEqual(['Alpha']);
  });

  it('round-trip: everything except the deleted nodes is byte-stable', () => {
    // Expected = the SAME fixture authored without Beta, normalized through the
    // pipeline's own parse→serialize pair. Any collateral mutation (attribute
    // reorder, whitespace, entity flip, sibling node loss) breaks byte equality.
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({
        sheets: ['Alpha', 'Beta', 'Gamma'],
        dashboards: [dashboardXml('Dash One', 'Alpha')],
        extraWindows: ["<window class='dashboard' name='Dash One'><viewpoints/></window>"],
      }),
      'Beta',
    );
    invariant(result.status === 'removed');
    const expected = serializeXML(
      parseXML(
        buildWorkbook({
          sheets: ['Alpha', 'Gamma'],
          dashboards: [dashboardXml('Dash One', 'Alpha')],
          extraWindows: ["<window class='dashboard' name='Dash One'><viewpoints/></window>"],
        }),
      ),
    );
    expect(result.xml).toBe(expected);
    // Re-read: sheet gone, window gone, dashboard + its window intact.
    expect(worksheetNames(result.xml)).toEqual(['Alpha', 'Gamma']);
    expect(windowEntries(result.xml)).toEqual([
      { name: 'Alpha', klass: 'worksheet' },
      { name: 'Gamma', klass: 'worksheet' },
      { name: 'Dash One', klass: 'dashboard' },
    ]);
  });

  it('refuses when a dashboard zone references the sheet, naming the dashboard', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({ dashboards: [dashboardXml('Dash One', 'Alpha')] }),
      'Alpha',
    );
    expect(result).toEqual({ status: 'dashboard-referenced', dashboards: ['Dash One'] });
  });

  it('refuses when an escaped dashboard zone references a literal ampersand worksheet', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({
        sheets: ['Alpha', 'P&amp;L Waterfall: Revenue to Net Income'],
        dashboards: [dashboardXml('Dash One', 'P&amp;L Waterfall: Revenue to Net Income')],
      }),
      'P&L Waterfall: Revenue to Net Income',
    );

    expect(result).toEqual({ status: 'dashboard-referenced', dashboards: ['Dash One'] });
  });

  it('names EVERY referencing dashboard, and the zone match survives nesting', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({
        dashboards: [
          dashboardXml('Dash One', 'Alpha'),
          dashboardXml('Unrelated', 'Beta'),
          dashboardXml('Dash Two', 'Alpha'),
        ],
      }),
      'Alpha',
    );
    expect(result).toEqual({
      status: 'dashboard-referenced',
      dashboards: ['Dash One', 'Dash Two'],
    });
  });

  it('refuses on a zone reference outside any named dashboard (catch-all oracle)', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({ extraBody: "<zones><zone name='Beta'/></zones>" }),
      'Beta',
    );
    expect(result).toEqual({ status: 'dashboard-referenced', dashboards: [] });
  });

  it('returns not-found with the existing sheet names', () => {
    const result = removeWorksheetFromWorkbook(buildWorkbook(), 'Nope');
    expect(result).toEqual({ status: 'not-found', worksheets: ['Alpha', 'Beta'] });
  });

  it('refuses to delete the last remaining worksheet', () => {
    const result = removeWorksheetFromWorkbook(buildWorkbook({ sheets: ['Alpha'] }), 'Alpha');
    expect(result).toEqual({ status: 'last-worksheet' });
  });

  it('returns parse-failed on unparseable XML instead of throwing', () => {
    // A bare `<` outside a tag is one of the few inputs fast-xml-parser actually
    // throws on (it is lenient about unclosed/mismatched tags).
    const result = removeWorksheetFromWorkbook('a < b', 'Alpha');
    expect(result.status).toBe('parse-failed');
  });

  it('never removes a dashboard window sharing the sheet name (class guard)', () => {
    const result = removeWorksheetFromWorkbook(
      buildWorkbook({
        dashboards: [dashboardXml('Beta')],
        extraWindows: ["<window class='dashboard' name='Beta'><viewpoints/></window>"],
      }),
      'Beta',
    );
    invariant(result.status === 'removed');
    expect(windowEntries(result.xml)).toEqual([
      { name: 'Alpha', klass: 'worksheet' },
      { name: 'Beta', klass: 'dashboard' },
    ]);
  });
});

// ── Tool ──────────────────────────────────────────────────────────────────────

const successSchema = z.object({
  deleted: z.literal(true),
  worksheet: z.string(),
  guidance: z.string(),
});

const refusalSchema = z.object({
  deleted: z.literal(false),
  reason: z.enum(['dashboard-referenced', 'last-worksheet', 'user-changed-workbook']),
  dashboards: z.array(z.string()).optional(),
  guidance: z.string(),
});

describe('deleteWorksheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDeleteWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('delete-worksheet');
    expect(tool.description).toBe('Delete a worksheet safely.');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Delete Worksheet',
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
    });
  });

  it('deletes an unreferenced sheet and dispatches exactly the core removal XML', async () => {
    const fixture = buildWorkbook({
      dashboards: [dashboardXml('Dash One', 'Alpha')],
      extraWindows: ["<window class='dashboard' name='Dash One'><viewpoints/></window>"],
    });
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(fixture));
    const loadSpy = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({ worksheetName: 'Beta' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.worksheet).toBe('Beta');

    // The applied XML is byte-identical to the pure core's output for the same
    // fixture — the tool adds nothing and loses nothing between core and dispatch.
    const expected = removeWorksheetFromWorkbook(fixture, 'Beta');
    invariant(expected.status === 'removed');
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith(expect.objectContaining({ xml: expected.xml }));
  });

  it('refuses a dashboard-referenced sheet, names the dashboards, and dispatches nothing', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(buildWorkbook({ dashboards: [dashboardXml('Dash One', 'Alpha')] })),
    );
    const loadSpy = vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml');

    const result = await getToolResult({ worksheetName: 'Alpha' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toBe('dashboard-referenced');
    expect(parsed.dashboards).toEqual(['Dash One']);
    expect(parsed.guidance).toContain('"Dash One"');
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('refuses when the user changed the workbook between read and apply (events gate)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(buildWorkbook()));
    const loadSpy = vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml');
    const getEvents = vi
      .fn()
      .mockResolvedValueOnce(Ok({ events: [], latest_sequence: 41, count: 0 }))
      .mockResolvedValue(Ok({ events: [{}], latest_sequence: 42, count: 1 }));

    const result = await getToolResult({ worksheetName: 'Beta', getEvents });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toBe('user-changed-workbook');
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ sinceSequence: 41 }));
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('proceeds without the events gate on transports without event support', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(buildWorkbook()));
    const loadSpy = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));
    const getEvents = vi.fn().mockResolvedValue(Err('events unsupported on this transport'));

    const result = await getToolResult({ worksheetName: 'Beta', getEvents });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    successSchema.parse(JSON.parse(result.content[0].text));
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses to delete the last remaining worksheet', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(buildWorkbook({ sheets: ['Alpha'] })),
    );
    const loadSpy = vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml');

    const result = await getToolResult({ worksheetName: 'Alpha' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = refusalSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.reason).toBe('last-worksheet');
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('errors with WorksheetNotFoundError when the sheet does not exist', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(buildWorkbook()));

    const result = await getToolResult({ worksheetName: 'Nope' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new WorksheetNotFoundError(
        'Worksheet "Nope" was not found in the workbook. Existing worksheets: "Alpha", "Beta". ' +
          'Use list-worksheets to see the current sheet names.',
      ).message,
    );
  });

  it('errors with DesktopCommandExecutionError when the workbook read fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ worksheetName: 'Beta' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('maps apply failures to the standard apply-path error types', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(buildWorkbook()));
    const loadError = {
      type: 'load-workbook-xml-error' as const,
      error: { type: 'invalid-xml' as const },
    };
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(loadError));

    const result = await getToolResult({ worksheetName: 'Beta' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new WorkbookXmlLoadFailedError(loadError.error).message);

    const commandError = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(commandError));

    const result2 = await getToolResult({ worksheetName: 'Beta' });

    expect(result2.isError).toBe(true);
    invariant(result2.content[0].type === 'text');
    expect(result2.content[0].text).toBe(
      new DesktopCommandExecutionError(commandError.error).message,
    );
  });
});

async function getToolResult({
  worksheetName,
  getEvents = vi.fn().mockResolvedValue(Ok({ events: [], latest_sequence: 41, count: 0 })),
}: {
  worksheetName: string;
  getEvents?: ReturnType<typeof vi.fn>;
}): Promise<CallToolResult> {
  const tool = getDeleteWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({ getEvents }),
  };

  return await callback({ session: '12345', worksheetName }, extra);
}
