import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import type { ParsedWindow } from '../../../desktop/metadata/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { activateSheetInWorkbook, getActivateSheetTool } from './activateSheet.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');

function worksheetXml(name: string): string {
  return `<worksheet name='${name}'><table><view/><style/><panes><pane><view/></pane></panes></table></worksheet>`;
}

function worksheetWindowXml(
  name: string,
  attributes = '',
): string {
  return `<window class='worksheet' name='${name}'${attributes}><cards/></window>`;
}

function buildWorkbook(sheetNames = ['Alpha', 'Beta']): string {
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    "<workbook version='18.1'>",
    "<datasources><datasource name='Superstore'/></datasources>",
    `<worksheets>${sheetNames.map(worksheetXml).join('')}</worksheets>`,
    '<windows>',
    worksheetWindowXml(sheetNames[0], " active='true' maximized='true'"),
    ...sheetNames.slice(1).map((name) => worksheetWindowXml(name)),
    '</windows>',
    '</workbook>',
  ].join('');
}

function worksheetWindows(xml: string): ParsedWindow[] {
  return normalizeArray<ParsedWindow>(parseXML(xml).workbook?.windows?.window).filter(
    (window) => window['@_class'] === 'worksheet',
  );
}

const successSchema = z.object({
  activated: z.literal(true),
  sheetName: z.string(),
  message: z.string(),
});

describe('activateSheetInWorkbook', () => {
  it('moves the active worksheet window marker to the requested sheet', () => {
    const result = activateSheetInWorkbook(buildWorkbook(), 'Beta');

    invariant(result.status === 'activated');
    const windows = worksheetWindows(result.xml);
    expect(windows.find((window) => window['@_name'] === 'Alpha')).not.toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
    expect(windows.find((window) => window['@_name'] === 'Beta')).toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
  });
});

describe('activateSheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('holds the apply lock across reading, mutating, and applying', async () => {
    const firstLoad = deferred<Awaited<ReturnType<typeof loadWorkbookXmlModule.loadWorkbookXml>>>();
    const secondLoad = deferred<Awaited<ReturnType<typeof loadWorkbookXmlModule.loadWorkbookXml>>>();
    const firstApply = deferred<
      Awaited<ReturnType<typeof loadWorkbookXmlModule.applyWorkbookText>>
    >();
    const secondApply = deferred<
      Awaited<ReturnType<typeof loadWorkbookXmlModule.applyWorkbookText>>
    >();
    const getSpy = vi
      .spyOn(getWorkbookXmlModule, 'getWorkbookXml')
      .mockResolvedValue(Ok(buildWorkbook()));
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);
    vi.spyOn(loadWorkbookXmlModule, 'applyWorkbookText')
      .mockReturnValueOnce(firstApply.promise)
      .mockReturnValueOnce(secondApply.promise);

    const firstResult = getToolResult({ sheetName: 'Beta' });
    const secondResult = getToolResult({ sheetName: 'Beta' });

    try {
      await flushAsyncWork();

      expect(getSpy).toHaveBeenCalledTimes(1);
    } finally {
      firstLoad.resolve(Ok({ validationWarnings: [] }));
      secondLoad.resolve(Ok({ validationWarnings: [] }));
      firstApply.resolve(Ok.EMPTY);
      secondApply.resolve(Ok.EMPTY);
      await Promise.allSettled([firstResult, secondResult]);
    }
  });

  it('applies a workbook with only the active sheet changed and returns no XML', async () => {
    const fixture = buildWorkbook();
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(fixture));
    const applySpy = vi.spyOn(loadWorkbookXmlModule, 'applyWorkbookText').mockResolvedValue(Ok.EMPTY);

    const result = await getToolResult({ sheetName: 'Beta' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.sheetName).toBe('Beta');
    expect(parsed.message).toContain('Activated sheet "Beta"');
    expect(parsed).not.toHaveProperty('workbookXml');
    const appliedXml = applySpy.mock.calls[0]?.[0].xml;
    expect(typeof appliedXml).toBe('string');
    const betaWindow = worksheetWindows(String(appliedXml)).find(
      (window) => window['@_name'] === 'Beta',
    );
    expect(betaWindow).toMatchObject({ '@_active': 'true', '@_maximized': 'true' });
  });

  it('errors for an unknown sheet with the available sheets and dispatches nothing', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(buildWorkbook(['Revenue "Q1"', 'Profit, YoY'])),
    );
    const applySpy = vi.spyOn(loadWorkbookXmlModule, 'applyWorkbookText');

    const result = await getToolResult({ sheetName: 'Missing' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet "Missing" was not found');
    expect(result.structuredContent).toEqual({
      availableSheets: ['Revenue "Q1"', 'Profit, YoY'],
    });
    expect(applySpy).not.toHaveBeenCalled();
  });
});

async function getToolResult({ sheetName }: { sheetName: string }): Promise<CallToolResult> {
  const tool = getActivateSheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({}),
  };

  return await callback({ session: '12345', sheetName }, extra);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
