import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { activateSheetValidated } from '../../../desktop/wrappers/activateSheet.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getActivateSheetTool } from './activateSheet.js';

function worksheetXml(name: string): string {
  return `<worksheet name='${name}'><table><view/><style/><panes><pane><view/></pane></panes></table></worksheet>`;
}

function dashboardXml(name: string): string {
  return `<dashboard name='${name}'><style/><zones/></dashboard>`;
}

function windowXml(name: string, windowClass: 'worksheet' | 'dashboard', attributes = ''): string {
  return `<window class='${windowClass}' name='${name}'${attributes}><cards/></window>`;
}

function buildWorkbook({
  worksheetNames = ['Alpha', 'Beta'],
  dashboardNames = [],
  activeSheetName,
}: {
  worksheetNames?: string[];
  dashboardNames?: string[];
  activeSheetName?: string;
} = {}): string {
  const firstSheet = activeSheetName ?? worksheetNames[0] ?? dashboardNames[0];
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    "<workbook version='18.1'>",
    "<datasources><datasource name='Superstore'/></datasources>",
    `<worksheets>${worksheetNames.map(worksheetXml).join('')}</worksheets>`,
    `<dashboards>${dashboardNames.map(dashboardXml).join('')}</dashboards>`,
    '<windows>',
    ...worksheetNames.map((name) =>
      windowXml(name, 'worksheet', name === firstSheet ? " active='true' maximized='true'" : ''),
    ),
    ...dashboardNames.map((name) =>
      windowXml(name, 'dashboard', name === firstSheet ? " active='true' maximized='true'" : ''),
    ),
    '</windows>',
    '</workbook>',
  ].join('');
}

const successSchema = z.object({
  focus_requested: z.boolean(),
  sheetName: z.string(),
  message: z.string(),
  availableSheets: z.array(z.string()),
});

// The post-apply focus path (applyFocus.ts) still drives navigation through the XML-read
// validated goto; the tool no longer does. These pin that surviving core command fn.
describe('activateSheetValidated', () => {
  const signal = new AbortController().signal;

  it('fresh-reads the workbook before issuing goto-sheet with the exact target', async () => {
    const { executor, getWorkbookDocument, executeCommand } = makeXmlExecutor();

    const result = await activateSheetValidated({ sheetName: 'Beta', executor, signal });

    expect(result).toEqual({
      status: 'activated',
      previousSheet: 'Alpha',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(getWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { Sheet: 'Beta' },
      signal,
    });
  });

  it('refuses a missing sheet without issuing any command', async () => {
    const { executor, executeCommand } = makeXmlExecutor();

    const result = await activateSheetValidated({ sheetName: 'Missing', executor, signal });

    expect(result).toEqual({ status: 'not-found', availableSheets: ['Alpha', 'Beta'] });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('dispatches nothing when the target window is already the maximized one', async () => {
    const { executor, executeCommand } = makeXmlExecutor({
      xml: buildWorkbook({ activeSheetName: 'Beta' }),
    });

    const result = await activateSheetValidated({ sheetName: 'Beta', executor, signal });

    expect(result).toEqual({
      status: 'already-active',
      previousSheet: 'Beta',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

describe('activateSheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the name to an id from the inventory and requests focus via goToSheet', async () => {
    const { executor, goToSheet } = makeApiExecutor();

    const result = await getToolResult({ sheetName: 'Sales by Region', executor });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.sheetName).toBe('Sales by Region');
    expect(parsed.focus_requested).toBe(true);
    expect(parsed.message).toContain('Requested focus on sheet "Sales by Region"');
    expect(parsed.availableSheets).toEqual([
      'Sales by Region',
      'Profit',
      'Executive Dashboard',
      'QBR Story',
    ]);
    expect(goToSheet).toHaveBeenCalledWith('sheet-sales', expect.anything());
  });

  it('resolves a dashboard target and requests focus by its id', async () => {
    const { executor, goToSheet } = makeApiExecutor();

    const result = await getToolResult({ sheetName: 'Executive Dashboard', executor });

    expect(result.isError).toBe(false);
    expect(goToSheet).toHaveBeenCalledWith('dash-exec', expect.anything());
  });

  it('resolves a storyboard target and requests focus by its id', async () => {
    const { executor, goToSheet } = makeApiExecutor();

    const result = await getToolResult({ sheetName: 'QBR Story', executor });

    expect(result.isError).toBe(false);
    expect(goToSheet).toHaveBeenCalledWith('story-qbr', expect.anything());
  });

  it('errors for an unknown sheet with the available sheets and issues no command', async () => {
    const { executor, goToSheet } = makeApiExecutor();

    const result = await getToolResult({ sheetName: 'Missing', executor });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet "Missing" was not found');
    expect(result.structuredContent).toEqual({
      message: result.content[0].text,
      availableSheets: ['Sales by Region', 'Profit', 'Executive Dashboard', 'QBR Story'],
      nextAction: {
        label: 'Choose an available sheet and retry',
        kind: 'prefill',
      },
    });
    expect(goToSheet).not.toHaveBeenCalled();
  });
});

async function getToolResult({
  sheetName,
  executor,
}: {
  sheetName: string;
  executor: ExternalApiToolExecutor;
}): Promise<CallToolResult> {
  const tool = getActivateSheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return await callback({ session: '12345', sheetName }, extra);
}

function makeApiExecutor(): {
  executor: ExternalApiToolExecutor;
  goToSheet: ReturnType<typeof vi.fn>;
} {
  const listWorksheets = vi.fn().mockResolvedValue(
    Ok({
      worksheets: [
        { id: 'sheet-sales', name: 'Sales by Region' },
        { id: 'sheet-profit', name: 'Profit' },
      ],
    }),
  );
  const listDashboards = vi
    .fn()
    .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-exec', name: 'Executive Dashboard' }] }));
  const listStoryboards = vi
    .fn()
    .mockResolvedValue(Ok({ storyboards: [{ id: 'story-qbr', name: 'QBR Story' }] }));
  const goToSheet = vi.fn().mockResolvedValue(Ok({ status: 'completed' }));
  return {
    executor: makeExecutorMock({ listWorksheets, listDashboards, listStoryboards, goToSheet }),
    goToSheet,
  };
}

function makeXmlExecutor({ xml = buildWorkbook() }: { xml?: string } = {}): {
  executor: ExternalApiToolExecutor;
  getWorkbookDocument: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
} {
  const getWorkbookDocument = vi.fn().mockResolvedValue(
    Ok({
      xml,
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    }),
  );
  const executeCommand = vi.fn().mockResolvedValue(Ok({ command_id: 'goto-1' }));
  return {
    executor: makeExecutorMock({ getWorkbookDocument, executeCommand }),
    getWorkbookDocument,
    executeCommand,
  };
}
