import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { activateSheetValidated, resolveSheetId } from '../../../desktop/wrappers/activateSheet.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getActivateSheetTool } from './activateSheet.js';

const successSchema = z.object({
  focus_requested: z.boolean(),
  sheetName: z.string(),
  message: z.string(),
  availableSheets: z.array(z.string()),
});

describe('activateSheetValidated', () => {
  const signal = new AbortController().signal;

  it('reads the inventory once and navigates by the sheet id', async () => {
    const { executor, getWorkbook, getWorkbookDocument, goToSheet } = makeInventoryExecutor();

    const result = await activateSheetValidated({ sheetId: 'id-Beta', executor, signal });

    expect(result).toEqual({
      status: 'activated',
      previousSheet: 'Alpha',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(getWorkbook).toHaveBeenCalledExactlyOnceWith(signal);
    expect(getWorkbookDocument).not.toHaveBeenCalled();
    expect(goToSheet).toHaveBeenCalledExactlyOnceWith('id-Beta', signal);
  });

  it('refuses an unknown id without navigating', async () => {
    const { executor, goToSheet } = makeInventoryExecutor();

    const result = await activateSheetValidated({ sheetId: 'id-Missing', executor, signal });

    expect(result).toEqual({ status: 'not-found', availableSheets: ['Alpha', 'Beta'] });
    expect(goToSheet).not.toHaveBeenCalled();
  });

  it('does not treat a sheet name as an id', async () => {
    const { executor, goToSheet } = makeInventoryExecutor();

    const result = await activateSheetValidated({ sheetId: 'Beta', executor, signal });

    expect(result.status).toBe('not-found');
    expect(goToSheet).not.toHaveBeenCalled();
  });

  it('dispatches nothing when the sheet is already the active one', async () => {
    const { executor, goToSheet } = makeInventoryExecutor({ activeName: 'Beta' });

    const result = await activateSheetValidated({ sheetId: 'id-Beta', executor, signal });

    expect(result).toEqual({
      status: 'already-active',
      previousSheet: 'Beta',
      availableSheets: ['Alpha', 'Beta'],
    });
    expect(goToSheet).not.toHaveBeenCalled();
  });

  it('returns read-failed when the inventory read fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'inventory timeout' };
    const { executor, getWorkbook, goToSheet } = makeInventoryExecutor();
    getWorkbook.mockResolvedValue(Err(error));

    const result = await activateSheetValidated({ sheetId: 'id-Beta', executor, signal });

    expect(result).toEqual({ status: 'read-failed', error });
    expect(goToSheet).not.toHaveBeenCalled();
  });

  it('returns command-failed when goToSheet fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'goto timeout' };
    const { executor, goToSheet } = makeInventoryExecutor();
    goToSheet.mockResolvedValue(Err(error));

    const result = await activateSheetValidated({ sheetId: 'id-Beta', executor, signal });

    expect(result).toEqual({ status: 'command-failed', error });
  });
});

describe('resolveSheetId', () => {
  const signal = new AbortController().signal;
  const mixedInventory = {
    worksheets: [
      { id: 'sheet-sales', name: 'Sales by Region', hidden: false },
      { id: 'sheet-profit', name: 'Profit', hidden: false },
    ],
    dashboards: [{ id: 'dash-exec', name: 'Executive Dashboard', hidden: false }],
    storyboards: [{ id: 'story-qbr', name: 'QBR Story', hidden: false }],
  };

  it.each([
    { sheetName: 'Sales by Region', sheetId: 'sheet-sales' },
    { sheetName: 'Executive Dashboard', sheetId: 'dash-exec' },
    { sheetName: 'QBR Story', sheetId: 'story-qbr' },
  ])('resolves $sheetName to its id', async ({ sheetName, sheetId }) => {
    const { executor, getWorkbook } = makeInventoryExecutor({ inventory: mixedInventory });

    const result = await resolveSheetId({ sheetName, executor, signal });

    expect(result).toEqual({ status: 'resolved', sheetId });
    expect(getWorkbook).toHaveBeenCalledExactlyOnceWith(signal);
  });

  it('returns not-found with the available sheets for an unknown name', async () => {
    const { executor } = makeInventoryExecutor({ inventory: mixedInventory });

    const result = await resolveSheetId({ sheetName: 'Missing', executor, signal });

    expect(result).toEqual({
      status: 'not-found',
      availableSheets: ['Sales by Region', 'Profit', 'Executive Dashboard', 'QBR Story'],
    });
  });

  it('returns read-failed when the inventory read fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'inventory timeout' };
    const { executor, getWorkbook } = makeInventoryExecutor();
    getWorkbook.mockResolvedValue(Err(error));

    const result = await resolveSheetId({ sheetName: 'Profit', executor, signal });

    expect(result).toEqual({ status: 'read-failed', error });
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

function makeInventoryExecutor({
  activeName = 'Alpha',
  inventory = {
    worksheets: ['Alpha', 'Beta'].map((name) => ({
      id: `id-${name}`,
      name,
      hidden: false,
      isActiveSheet: name === activeName,
    })),
  },
}: { activeName?: string; inventory?: object } = {}): {
  executor: ExternalApiToolExecutor;
  getWorkbookDocument: ReturnType<typeof vi.fn>;
  getWorkbook: ReturnType<typeof vi.fn>;
  goToSheet: ReturnType<typeof vi.fn>;
} {
  const getWorkbookDocument = vi.fn();
  const getWorkbook = vi
    .fn()
    .mockResolvedValue(Ok({ title: 'Book', unsavedChanges: false, ...inventory }));
  const goToSheet = vi
    .fn()
    .mockResolvedValue(Ok({ command_id: 'goto-1', status: 'completed', submitted_at: '' }));
  return {
    executor: makeExecutorMock({ getWorkbookDocument, getWorkbook, goToSheet }),
    getWorkbookDocument,
    getWorkbook,
    goToSheet,
  };
}
