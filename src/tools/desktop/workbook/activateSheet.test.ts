import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  activateSheetBestEffort,
  activateSheetWithValidatedGoto,
} from '../../../desktop/commands/workbook/activateSheet.js';
import type { ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import * as loggerModule from '../../../logging/logger.js';
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
  activated: z.literal(true),
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

describe('activateSheetBestEffort', () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('swallows a goto-sheet failure and logs the skipped activation', async () => {
    const commandError = { type: 'command-timed-out' as const, error: 'activation timeout' };
    const { executor } = makeExecutor({
      executeResult: Err(commandError),
    });
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);

    const activation = activateSheetBestEffort({
      sheetName: 'Beta',
      executor,
      signal,
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(activation).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        data: expect.objectContaining({ sheetName: 'Beta' }),
      }),
    );
    logSpy.mockRestore();
  });

  it('does not navigate when validation cannot find the target', async () => {
    const { executor, executeCommand } = makeExecutor({
      xml: buildWorkbook({ worksheetNames: ['Alpha'] }),
    });

    const activation = activateSheetBestEffort({
      sheetName: 'Beta',
      executor,
      signal,
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(activation).resolves.toBeUndefined();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('waits for settle, verifies focus, and reissues goto-sheet once after snap-back', async () => {
    const { executor, getWorkbookDocument, executeCommand } = makeExecutor({
      xmlSequence: [
        buildWorkbook({ activeSheetName: 'Alpha' }),
        buildWorkbook({ activeSheetName: 'Alpha' }),
        buildWorkbook({ activeSheetName: 'Alpha' }),
      ],
    });

    const activation = activateSheetBestEffort({
      sheetName: 'Beta',
      executor,
      signal,
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(executeCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Beta' } }),
    );

    await vi.advanceTimersByTimeAsync(699);
    expect(getWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(activation).resolves.toBeUndefined();
    expect(getWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Beta' } }),
    );
  });

  it('does not reissue goto-sheet when the verification read shows the target is focused', async () => {
    const { executor, getWorkbookDocument, executeCommand } = makeExecutor({
      xmlSequence: [
        buildWorkbook({ activeSheetName: 'Alpha' }),
        buildWorkbook({ activeSheetName: 'Beta' }),
      ],
    });

    const activation = activateSheetBestEffort({
      sheetName: 'Beta',
      executor,
      signal,
    });

    await vi.advanceTimersByTimeAsync(1200);

    await expect(activation).resolves.toBeUndefined();
    expect(getWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenCalledTimes(1);
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
    expect(parsed.message).toContain('Activated sheet "Beta"');
    expect(parsed.previousSheet).toBe('Alpha');
    expect(parsed.availableSheets).toEqual(['Alpha', 'Beta']);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Beta' } }),
    );
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
