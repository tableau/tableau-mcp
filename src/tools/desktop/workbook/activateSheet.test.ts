import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { activateSheetWithValidatedGoto } from '../../../desktop/commands/workbook/activateSheet.js';
import type { ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
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
  previousSheet: z.string().optional(),
  availableSheets: z.array(z.string()),
});

describe('activateSheetWithValidatedGoto', () => {
  const signal = new AbortController().signal;

  it('fresh-reads the workbook before issuing goto-sheet with the exact target', async () => {
    const { executor, getWorkbookDocument, executeCommand } = makeExecutor();

    const result = await activateSheetWithValidatedGoto({
      sheetName: 'Beta',
      executor,
      signal,
    });

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
    const { executor, executeCommand } = makeExecutor();

    const result = await activateSheetWithValidatedGoto({
      sheetName: 'Missing',
      executor,
      signal,
    });

    expect(result).toEqual({
      status: 'not-found',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('uses an exact case-sensitive name check', async () => {
    const { executor, executeCommand } = makeExecutor();

    const result = await activateSheetWithValidatedGoto({
      sheetName: 'beta',
      executor,
      signal,
    });

    expect(result).toEqual({
      status: 'not-found',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('dispatches nothing when the target window is already the maximized one', async () => {
    const { executor, getWorkbookDocument, executeCommand } = makeExecutor({
      xml: buildWorkbook({ activeSheetName: 'Beta' }),
    });

    const result = await activateSheetWithValidatedGoto({
      sheetName: 'Beta',
      executor,
      signal,
    });

    expect(result).toEqual({
      status: 'already-active',
      previousSheet: 'Beta',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(getWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('accepts a dashboard found in the same fresh workbook read', async () => {
    const { executor, executeCommand } = makeExecutor({
      xml: buildWorkbook({ dashboardNames: ['Sales Dashboard'] }),
    });

    const result = await activateSheetWithValidatedGoto({
      sheetName: 'Sales Dashboard',
      executor,
      signal,
    });

    expect(result.status).toBe('activated');
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { Sheet: 'Sales Dashboard' },
      }),
    );
  });
});

describe('activateSheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates through validated goto-sheet and returns read-derived context', async () => {
    const { executor, executeCommand } = makeExecutor();

    const result = await getToolResult({ sheetName: 'Beta', executor });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.sheetName).toBe('Beta');
    expect(parsed.focus_requested).toBe(true);
    expect(parsed.message).toContain('Requested focus on sheet "Beta"');
    expect(parsed.previousSheet).toBe('Alpha');
    expect(parsed.availableSheets).toEqual(['Alpha', 'Beta']);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Beta' } }),
    );
  });

  it('reports focus_requested false when the sheet is already active', async () => {
    const { executor, executeCommand } = makeExecutor({
      xml: buildWorkbook({ activeSheetName: 'Beta' }),
    });

    const result = await getToolResult({ sheetName: 'Beta', executor });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = successSchema.parse(JSON.parse(result.content[0].text));
    expect(parsed.focus_requested).toBe(false);
    expect(parsed.message).toContain('was already the active sheet');
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('errors for an unknown sheet with the available sheets and issues no command', async () => {
    const { executor, executeCommand } = makeExecutor({
      xml: buildWorkbook({ worksheetNames: ['Revenue "Q1"', 'Profit, YoY'] }),
    });

    const result = await getToolResult({ sheetName: 'Missing', executor });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet "Missing" was not found');
    expect(result.structuredContent).toEqual({
      availableSheets: ['Revenue "Q1"', 'Profit, YoY'],
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

async function getToolResult({
  sheetName,
  executor,
}: {
  sheetName: string;
  executor: ToolExecutor;
}): Promise<CallToolResult> {
  const tool = getActivateSheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return await callback({ session: '12345', sheetName }, extra);
}

function makeExecutor({
  xml = buildWorkbook(),
  xmlSequence,
  executeResult = Ok({ command_id: 'goto-1' }),
}: {
  xml?: string;
  xmlSequence?: string[];
  executeResult?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
} = {}): {
  executor: ToolExecutor;
  getWorkbookDocument: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
} {
  const getWorkbookDocument = vi.fn();
  const xmls = xmlSequence && xmlSequence.length > 0 ? xmlSequence : [xml];
  for (const entry of xmls) {
    getWorkbookDocument.mockResolvedValueOnce(
      Ok({
        xml: entry,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
    );
  }
  getWorkbookDocument.mockResolvedValue(
    Ok({
      xml: xmls[xmls.length - 1],
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    }),
  );
  const executeCommand = vi.fn().mockResolvedValue(executeResult);
  return {
    executor: { getWorkbookDocument, executeCommand } as unknown as ToolExecutor,
    getWorkbookDocument,
    executeCommand,
  };
}
